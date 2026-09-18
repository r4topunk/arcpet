import {
  createClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  type Hex,
  zeroAddress,
  zeroHash,
} from 'viem';
import { describe, expect, it } from 'vitest';
import {
  arcMainnet,
  arcPetAbi,
  fulfillSignature,
  hatchPhase,
  InvalidPetNameError,
  parseEggLaid,
  RequestStatus,
  readHatchStatus,
  roundTime,
  Status,
  sendHatch,
  worstCaseFulfillBatchGas,
} from '../src/index.js';
import { makePet } from './helpers.js';
import { ARCPET, COORD, mockClient, mockState } from './mockChain.js';

const ROUND = 26_000_000n;
const READY = roundTime(ROUND);

describe('hatchPhase', () => {
  it('covers every branch', () => {
    const at = (petStatus: Status, status: RequestStatus, now: bigint) =>
      hatchPhase(petStatus, { status, round: ROUND }, now).phase;
    expect(at(Status.Alive, RequestStatus.Fulfilled, READY)).toBe('hatched');
    expect(at(Status.Buried, RequestStatus.Fulfilled, READY)).toBe('hatched');
    expect(at(Status.Egg, RequestStatus.Pending, READY - 1n)).toBe('waitingRound');
    expect(at(Status.Egg, RequestStatus.Pending, READY)).toBe('fulfillable');
    // R8: a refunded request is still fulfillable
    expect(at(Status.Egg, RequestStatus.Refunded, READY + 10_000n)).toBe('fulfillable');
    // R2: fulfilled but still an egg -> the callback failed -> claimGenes
    expect(at(Status.Egg, RequestStatus.Fulfilled, READY)).toBe('claimable');
    expect(at(Status.Egg, RequestStatus.None, READY)).toBe('unknownRequest');
    expect(hatchPhase(Status.Egg, { status: 1, round: ROUND }, 0n).readyAt).toBe(READY);
  });
});

describe('parseEggLaid', () => {
  it('decodes the event from a hatch receipt', () => {
    const topics = encodeEventTopics({
      abi: arcPetAbi,
      eventName: 'EggLaid',
      args: { id: 7n, owner: '0x000000000000000000000000000000000000a11c', requestId: 42n },
    });
    const data = encodeAbiParameters([{ type: 'uint64' }, { type: 'string' }], [ROUND, 'Mochi']);
    const log = {
      address: ARCPET,
      topics: topics as [Hex, ...Hex[]],
      data,
      blockHash: zeroHash,
      blockNumber: 1n,
      logIndex: 0,
      transactionHash: zeroHash,
      transactionIndex: 0,
      removed: false,
    };
    expect(parseEggLaid({ logs: [log] }, ARCPET)).toEqual({
      id: 7n,
      owner: getAddress('0x000000000000000000000000000000000000a11c'),
      requestId: 42n,
      round: ROUND,
      name: 'Mochi',
    });
    expect(parseEggLaid({ logs: [log] }, zeroAddress)).toBeUndefined();
    expect(parseEggLaid({ logs: [] })).toBeUndefined();
  });
});

describe('readHatchStatus / fulfillSignature (mock chain)', () => {
  const egg = makePet({ id: 1n, asOf: READY });
  const req = (status: RequestStatus) => ({
    requester: ARCPET,
    round: ROUND,
    callbackGasLimit: 100_000,
    status,
    bounty: 0n,
    createdAt: READY - 12n,
    randomness: `0x${'00'.repeat(32)}` as Hex,
  });

  it('egg with a fulfilled request is claimable (callback failed)', async () => {
    const s = mockState([egg]);
    s.requests.set(1n, req(RequestStatus.Fulfilled));
    s.roundRandomness.set(ROUND, `0x${'ab'.repeat(32)}`);
    const st = await readHatchStatus(mockClient(s), {
      arcPet: ARCPET,
      coordinator: COORD,
      id: 1n,
      now: READY,
    });
    expect(st.phase).toBe('claimable');
    expect(st.roundVerified).toBe(true);
  });

  it('pending egg before its round waits; after it is fulfillable', async () => {
    const s = mockState([egg]);
    s.requests.set(1n, req(RequestStatus.Pending));
    const c = mockClient(s);
    const before = await readHatchStatus(c, { arcPet: ARCPET, coordinator: COORD, id: 1n, now: READY - 3n });
    expect(before.phase).toBe('waitingRound');
    expect(before.readyAt).toBe(READY);
    const after = await readHatchStatus(c, { arcPet: ARCPET, coordinator: COORD, id: 1n, now: READY });
    expect(after.phase).toBe('fulfillable');
    expect(after.roundVerified).toBe(false);
  });

  it('uses "0x" for an already verified round, else the (injected) drand beacon', async () => {
    const s = mockState();
    const c = mockClient(s);
    const beacon = {
      round: ROUND,
      signature: `0x${'8'.padEnd(96, '1')}` as Hex,
      randomness: `0x${'00'.repeat(32)}` as Hex,
    };
    expect(await fulfillSignature(c, { coordinator: COORD, round: ROUND, beacon })).toEqual({
      signature: beacon.signature,
      freshRound: true,
    });
    await expect(fulfillSignature(c, { coordinator: COORD, round: ROUND + 1n, beacon })).rejects.toThrow(
      /expected/,
    );
    s.roundRandomness.set(ROUND, `0x${'cd'.repeat(32)}`);
    expect(await fulfillSignature(c, { coordinator: COORD, round: ROUND, beacon })).toEqual({
      signature: '0x',
      freshRound: false,
    });
  });

  it('fulfill gas bound leaves the full 100k callback budget', () => {
    const fresh = worstCaseFulfillBatchGas({ freshRound: true, callbackGasLimits: [100_000] });
    expect(fresh).toBeGreaterThan(100_000n + 250_000n);
    expect(fresh).toBeLessThan(600_000n);
  });
});

describe('sendHatch (returns at broadcast)', () => {
  const HASH = `0x${'ab'.repeat(32)}` as const;
  const FROM = getAddress('0x00000000000000000000000000000000000b0b01');

  function rpc() {
    const methods: string[] = [];
    const request = async ({ method }: { method: string; params?: unknown }) => {
      methods.push(method);
      switch (method) {
        case 'eth_chainId':
          return '0x13b2'; // 5042
        case 'eth_call':
          return encodeFunctionResult({ abi: arcPetAbi, functionName: 'hatch', result: [1n, 7n] });
        case 'eth_sendTransaction':
          return HASH;
        default:
          throw new Error(`unexpected RPC ${method}`);
      }
    };
    const transport = custom({ request });
    return {
      methods,
      pub: createClient({ chain: arcMainnet, transport }),
      wallet: createWalletClient({ chain: arcMainnet, transport, account: FROM }),
    };
  }

  it('simulates, broadcasts and returns the hash without waiting for a receipt', async () => {
    const { methods, pub, wallet } = rpc();
    await expect(sendHatch(pub, wallet, { arcPet: ARCPET, name: 'Mochi' })).resolves.toBe(HASH);
    expect(methods).toContain('eth_call');
    expect(methods).toContain('eth_sendTransaction');
    expect(methods.some((m) => m.includes('Receipt') || m === 'eth_blockNumber')).toBe(false);
  });

  it('rejects an invalid name before any RPC', async () => {
    const { methods, pub, wallet } = rpc();
    await expect(sendHatch(pub, wallet, { arcPet: ARCPET, name: 'bad<name' })).rejects.toBeInstanceOf(
      InvalidPetNameError,
    );
    expect(methods).toHaveLength(0);
  });
});
