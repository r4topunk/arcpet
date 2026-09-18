// A minimal in-memory EIP-1193 transport: answers eth_call for ArcPet, the ArcDraw coordinator and Multicall3 from
// plain objects, so reads (listPets, readHatchStatus, fulfillSignature) run through real viem encoding/decoding.
import {
  type Address,
  createClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  multicall3Abi,
  zeroHash,
} from 'viem';
import {
  arcDrawCoordinatorAbi,
  arcMainnet,
  arcPetAbi,
  type CoordinatorRequest,
  MULTICALL3,
  type PetInfo,
} from '../src/index.js';

export const ARCPET: Address = '0x00000000000000000000000000000000000a4c07';
export const COORD: Address = '0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324';

export interface MockState {
  pets: PetInfo[];
  requests: Map<bigint, CoordinatorRequest>;
  roundRandomness: Map<bigint, Hex>;
  calls: { to: string; fn: string }[];
}

export function mockState(pets: PetInfo[] = []): MockState {
  return { pets, requests: new Map(), roundRandomness: new Map(), calls: [] };
}

function arcPetCall(s: MockState, data: Hex): Hex {
  const { functionName, args } = decodeFunctionData({ abi: arcPetAbi, data });
  s.calls.push({ to: 'arcPet', fn: functionName });
  switch (functionName) {
    case 'totalSupply':
      return encodeFunctionResult({ abi: arcPetAbi, functionName, result: BigInt(s.pets.length) });
    case 'petInfo': {
      const pet = s.pets[Number(args[0]) - 1];
      if (!pet) throw new Error('NonexistentPet');
      return encodeFunctionResult({ abi: arcPetAbi, functionName, result: pet });
    }
    default:
      throw new Error(`mock: ArcPet.${functionName} not implemented`);
  }
}

function coordCall(s: MockState, data: Hex): Hex {
  const { functionName, args } = decodeFunctionData({ abi: arcDrawCoordinatorAbi, data });
  s.calls.push({ to: 'coordinator', fn: functionName });
  if (functionName === 'getRequest') {
    const r = s.requests.get(args[0] as bigint);
    const empty = {
      requester: '0x0000000000000000000000000000000000000000' as Address,
      round: 0n,
      callbackGasLimit: 0,
      status: 0,
      bounty: 0n,
      createdAt: 0n,
      randomness: zeroHash,
    };
    return encodeFunctionResult({ abi: arcDrawCoordinatorAbi, functionName, result: r ?? empty });
  }
  if (functionName === 'roundRandomness') {
    return encodeFunctionResult({
      abi: arcDrawCoordinatorAbi,
      functionName,
      result: s.roundRandomness.get(args[0] as bigint) ?? zeroHash,
    });
  }
  throw new Error(`mock: coordinator.${functionName} not implemented`);
}

function call(s: MockState, to: string, data: Hex): Hex {
  const addr = to.toLowerCase();
  if (addr === ARCPET.toLowerCase()) return arcPetCall(s, data);
  if (addr === COORD.toLowerCase()) return coordCall(s, data);
  if (addr === MULTICALL3.toLowerCase()) {
    const { args } = decodeFunctionData({ abi: multicall3Abi, data });
    s.calls.push({ to: 'multicall', fn: 'aggregate3' });
    const calls = args[0] as readonly { target: Address; callData: Hex }[];
    const result = calls.map((c) => ({ success: true, returnData: call(s, c.target, c.callData) }));
    return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result });
  }
  throw new Error(`mock: unknown target ${to}`);
}

export function mockClient(s: MockState) {
  return createClient({
    chain: arcMainnet,
    transport: custom({
      async request({ method, params }) {
        if (method === 'eth_chainId') return '0x13b2';
        if (method === 'eth_call') {
          const [tx] = params as [{ to: string; data: Hex }];
          return call(s, tx.to, tx.data);
        }
        throw new Error(`mock: ${method} not implemented`);
      },
    }),
  });
}
