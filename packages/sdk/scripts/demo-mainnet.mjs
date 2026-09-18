#!/usr/bin/env node
// D17 demo on Arc mainnet, steps 1-2: hatch 3 named pets (main, B, C), fulfill each egg via drand, then B feeds C's pet.
// Keys come from env (PRIVATE_KEY, WALLET_B_PRIVATE_KEY, WALLET_C_PRIVATE_KEY) and are never printed.
// Writes tx hashes to deployments/arc-mainnet.json (demo.*). Run: node packages/sdk/scripts/demo-mainnet.mjs, after `pnpm --filter @arcpet/sdk build`.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  arcMainnet,
  arcPetAbi,
  fulfillEgg,
  hatch,
  readHatchStatus,
  readPet,
  roundTime,
  sendPetAction,
} from '../dist/index.js';

const DEPLOY = new URL('../../../deployments/arc-mainnet.json', import.meta.url);
const dep = JSON.parse(readFileSync(DEPLOY, 'utf8'));
const arcPet = dep.contracts.ArcPet.address;
const transport = http(dep.rpc);
const pub = createPublicClient({ chain: arcMainnet, transport });
const wallet = (k) =>
  createWalletClient({
    account: privateKeyToAccount(process.env[k].startsWith('0x') ? process.env[k] : `0x${process.env[k]}`),
    chain: arcMainnet,
    transport,
  });
const W = {
  main: wallet('PRIVATE_KEY'),
  B: wallet('WALLET_B_PRIVATE_KEY'),
  C: wallet('WALLET_C_PRIVATE_KEY'),
};
const NAMES = { main: 'Arcturus', B: 'Bolt', C: 'Cinder' };
const log = (...a) => console.log('[demo]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (hash) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`tx ${hash} reverted`);
  return r;
};

const eggs = {};
for (const k of ['main', 'B', 'C']) {
  const existing = await pub.readContract({
    address: arcPet,
    abi: arcPetAbi,
    functionName: 'petOf',
    args: [W[k].account.address],
  });
  if (existing !== 0n) {
    log(k, 'already has pet', existing, '- skipping hatch');
    eggs[k] = { id: existing };
    continue;
  }
  const { hash, egg } = await hatch(pub, W[k], { arcPet, name: NAMES[k] });
  log(k, 'hatch', hash, 'id', egg.id, 'request', egg.requestId, 'round', egg.round);
  eggs[k] = { ...egg, hash };
  dep.demo[`hatch${k === 'main' ? 'Main' : k}Tx`] = hash;
}

for (const k of ['main', 'B', 'C']) {
  const e = eggs[k];
  for (;;) {
    const st = await readHatchStatus(pub, { arcPet, id: e.id, now: BigInt(Math.floor(Date.now() / 1000)) });
    log(k, 'phase', st.phase);
    if (st.phase === 'hatched') break;
    if (st.phase === 'fulfillable') {
      const h = await fulfillEgg(pub, W.main, { requestId: st.pet.requestId });
      await wait(h);
      log(k, 'fulfill', h);
      if (!dep.demo.fulfillTx) dep.demo.fulfillTx = h;
      continue;
    }
    if (st.phase === 'claimable') {
      const h = await sendPetAction(pub, W.main, { arcPet, id: e.id, action: 'claimGenes' });
      await wait(h);
      log(k, 'claimGenes', h);
      dep.demo.claimGenesTx = h;
      continue;
    }
    await sleep(3000);
  }
}

const fh = await sendPetAction(pub, W.B, { arcPet, id: eggs.C.id, action: 'feed' });
await wait(fh);
log('B fed C pet', eggs.C.id, fh);
dep.demo.socialFeedTx = fh;
writeFileSync(DEPLOY, `${JSON.stringify(dep, null, 2)}\n`);

for (const k of ['main', 'B', 'C']) {
  const p = await readPet(pub, { arcPet, id: eggs[k].id });
  log(
    k,
    `id=${p.id} name=${p.name} status=${p.status} species=${p.species} deathAt=${new Date(Number(p.deathAt) * 1000).toISOString()}`,
  );
}
