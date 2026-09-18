#!/usr/bin/env node
// End-to-end check of the SDK against a throwaway LOCAL anvil (never a real network): the production ArcDraw
// coordinator code (BLS verified onchain via EIP-2537) + ArcPet, driven only through @arcpet/sdk (dist/).
// Offline: the drand beacon is the committed quicknet fixture (contracts/test/fixtures/Quicknet.sol, round 1,000,000).
// Uses anvil's unlocked dev accounts through JSON-RPC, so no key is ever handled.
//
// Flow A (happy path): hatch -> waitingRound -> fulfillEgg (callback hatches) -> feed by a third party -> listPets
//   (Multicall3) -> tokenURI decode -> petStateAt parity with petInfo.
// Flow B (R2 fallback, from a snapshot): hatch -> the callback is made to revert (ArcPet code swapped for a reverting
//   stub during fulfill) -> request Fulfilled, pet still Egg -> readHatchStatus says "claimable" -> claimGenes.
//
// Needs anvil (Foundry) and contracts/out (pnpm contracts:build), and the SDK build (pnpm --filter @arcpet/sdk build).
//   pnpm --filter @arcpet/sdk e2e:anvil
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, getContractAddress, http } from 'viem';
import {
  arcPetAbi,
  claimGenes,
  fulfillEgg,
  hatch,
  listPets,
  MULTICALL3,
  petStateAt,
  readHatchStatus,
  readPet,
  readTokenMetadata,
  roundTime,
  Status,
  sendPetAction,
} from '../dist/index.js';

const SDK = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.resolve(SDK, '../../contracts/out');
const ROUND = 1_000_000n;
const BEACON = {
  round: ROUND,
  signature:
    '0x83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72',
  randomness: '0xb22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3',
};
const USDC = '0x3600000000000000000000000000000000000000'; // no code on anvil; bounty is 0 so it is never called

const log = (...a) => console.log('[e2e]', ...a);
function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  log('ok', msg);
}
const artifact = (file, name) => JSON.parse(readFileSync(path.join(OUT, file, `${name}.json`), 'utf8'));

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const rpc = `http://127.0.0.1:${port}`;
const start = Number(roundTime(ROUND - 4n)) - 600;
const anvil = spawn(
  'anvil',
  ['--port', String(port), '--silent', '--hardfork', 'prague', '--timestamp', String(start)],
  {
    stdio: 'inherit',
  },
);
const stop = () => anvil.kill('SIGTERM');
process.on('exit', stop);

const chain = defineChain({
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
  contracts: { multicall3: { address: MULTICALL3 } },
});
const pub = createPublicClient({ chain, transport: http(rpc) });
const rpcCall = (method, params = []) => pub.request({ method, params });

async function waitForAnvil() {
  for (let i = 0; i < 100; i++) {
    try {
      await pub.getChainId();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('anvil did not start');
}

async function mineAt(ts) {
  await rpcCall('evm_mine', [Number(ts)]);
}

try {
  await waitForAnvil();
  const [alice, bob] = await rpcCall('eth_accounts');
  const wallet = (account) => createWalletClient({ account, chain, transport: http(rpc) });
  const walletA = wallet(alice);
  const walletB = wallet(bob);

  async function deploy(file, name, args) {
    const a = artifact(file, name);
    const nonce = await pub.getTransactionCount({ address: alice });
    const hash = await walletA.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`deploy ${name} failed`);
    return getContractAddress({ from: alice, nonce: BigInt(nonce) });
  }

  const coordinator = await deploy('ArcDrawCoordinator.sol', 'ArcDrawCoordinator', [USDC]);
  const arcPet = await deploy('ArcPet.sol', 'ArcPet', [coordinator]);
  log('coordinator', coordinator, 'ArcPet', arcPet);

  // Multicall3 runtime code is the same on every chain; put it at the canonical address of the local node.
  const mcCode = process.env.MULTICALL3_CODE ?? (await fetchMulticallCode());
  await rpcCall('anvil_setCode', [MULTICALL3, mcCode]);

  // ---------------------------------------------------------------- flow A
  const snap = await rpcCall('evm_snapshot');
  await rpcCall('evm_setNextBlockTimestamp', [Number(roundTime(ROUND - 4n))]);
  const { egg } = await hatch(pub, walletA, { arcPet, name: 'Mochi' });
  assert(egg.id === 1n && egg.round === ROUND && egg.name === 'Mochi', `egg #1 pinned to round ${ROUND}`);

  let st = await readHatchStatus(pub, { arcPet, coordinator, id: 1n, now: roundTime(ROUND) - 1n });
  assert(st.phase === 'waitingRound' && st.pet.status === Status.Egg, 'waitingRound before the round');

  await mineAt(roundTime(ROUND));
  st = await readHatchStatus(pub, { arcPet, coordinator, id: 1n, now: roundTime(ROUND) });
  assert(st.phase === 'fulfillable' && !st.roundVerified, 'fulfillable once the round is out');

  const fh = await fulfillEgg(pub, walletB, { coordinator, requestId: egg.requestId, beacon: BEACON });
  const fr = await pub.waitForTransactionReceipt({ hash: fh });
  assert(fr.status === 'success', `fulfill succeeded (gas used ${fr.gasUsed})`);
  const hatched = await pub.getContractEvents({ address: arcPet, abi: arcPetAbi, eventName: 'Hatched' });
  assert(hatched.length === 1 && hatched[0].args.viaClaim === false, 'Hatched via the callback');

  let pet = await readPet(pub, { arcPet, id: 1n });
  assert(pet.status === Status.Alive && pet.hunger === 100, 'pet #1 alive and full');

  const feedHash = await sendPetAction(pub, walletB, { arcPet, id: 1n, action: 'feed' });
  await pub.waitForTransactionReceipt({ hash: feedHash });
  const fedLogs = await pub.getContractEvents({ address: arcPet, abi: arcPetAbi, eventName: 'Fed' });
  assert(
    fedLogs.length === 1 && fedLogs[0].args.caller.toLowerCase() === bob.toLowerCase(),
    'third party fed pet #1 (R1)',
  );

  const all = await listPets(pub, { arcPet, chunkSize: 1 });
  assert(all.length === 1 && all[0].id === 1n, 'listPets via Multicall3');
  const { isAlive, ...state } = petStateAt(all[0], all[0].asOf);
  assert(
    JSON.stringify({ ...all[0], ...state }, (_, v) => (typeof v === 'bigint' ? `${v}` : v)) ===
      JSON.stringify(all[0], (_, v) => (typeof v === 'bigint' ? `${v}` : v)) && isAlive,
    'petStateAt == petInfo',
  );

  const meta = await readTokenMetadata(pub, { arcPet, id: 1n });
  assert(meta.name === 'Mochi #1' && meta.image.length > 100, 'tokenURI decodes');

  // ---------------------------------------------------------------- flow B (R2: failed callback -> claimGenes)
  await rpcCall('evm_revert', [snap]);
  await rpcCall('evm_setNextBlockTimestamp', [Number(roundTime(ROUND - 4n))]);
  const b = await hatch(pub, walletA, { arcPet, name: 'Claimy' });
  await mineAt(roundTime(ROUND));
  const code = await pub.getCode({ address: arcPet });
  await rpcCall('anvil_setCode', [arcPet, '0x5f5ffd']); // PUSH0 PUSH0 REVERT: every call reverts
  const bh = await fulfillEgg(pub, walletB, { coordinator, requestId: b.egg.requestId, beacon: BEACON });
  const br = await pub.waitForTransactionReceipt({ hash: bh });
  await rpcCall('anvil_setCode', [arcPet, code]);
  assert(br.status === 'success', 'fulfill succeeded although the callback reverted');

  st = await readHatchStatus(pub, { arcPet, coordinator, id: b.egg.id });
  assert(st.phase === 'claimable' && st.pet.status === Status.Egg, 'egg stuck -> claimable');
  const ch = await claimGenes(pub, walletB, { arcPet, id: b.egg.id });
  await pub.waitForTransactionReceipt({ hash: ch });
  pet = await readPet(pub, { arcPet, id: b.egg.id });
  assert(
    pet.status === Status.Alive && pet.genes === st.request.randomness,
    'claimGenes hatched with the stored randomness',
  );

  log('all good');
  stop();
  process.exit(0);
} catch (e) {
  console.error(e);
  stop();
  process.exit(1);
}

/** Multicall3 runtime code, read (eth_getCode, read-only) from Arc mainnet where it sits at the canonical address. */
async function fetchMulticallCode() {
  const res = await fetch('https://rpc.mainnet.arc.io', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [MULTICALL3, 'latest'] }),
  });
  const { result } = await res.json();
  if (!result || result === '0x') throw new Error('could not read Multicall3 code; set MULTICALL3_CODE');
  return result;
}
