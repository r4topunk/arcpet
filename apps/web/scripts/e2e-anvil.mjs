#!/usr/bin/env node
// End-to-end check of the static app against a throwaway LOCAL anvil (never a real network), in headless Chromium.
// An injected EIP-1193 provider forwards to anvil's unlocked dev accounts, so no key is ever handled. Offline: the
// drand request for round 1,000,000 is answered with the committed quicknet fixture (the app still verifies BLS).
//
// Flow: "not deployed" guard -> connect -> hatch "Mochi" -> egg waits for its round -> "Hatch now" (drand + fulfill)
// -> alive with bars -> a second wallet feeds it from /app/pet/?id=1 -> .ics download -> ranking lists it -> time
// passes -> dead -> bury by a third party -> graveyard -> PT-BR toggle. Fails on any console error.
//
// Needs anvil (Foundry), contracts/out (pnpm contracts:build), the SDK build and Chromium
// (pnpm exec playwright install chromium). It rebuilds apps/web/out for the local chain; run `pnpm build` afterwards
// for a normal export.
//   pnpm --filter @arcpet/web e2e:anvil
//   env SHOTS_DIR=/tmp/arcpet-shots pnpm --filter @arcpet/web e2e:anvil
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPublicClient, createWalletClient, http } from 'viem';
import { serveStatic } from './static-server.mjs';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.resolve(WEB, '../..');
const GENESIS = 1_692_803_367;
const roundTime = (r) => GENESIS + (r - 1) * 3;
const ROUND = 1_000_000; // contracts/test/fixtures/Quicknet.sol ROUND_A
const BEACON = {
  round: ROUND,
  signature:
    '83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72',
  randomness: 'b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3',
};
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const USDC = '0x3600000000000000000000000000000000000000';
const SHOTS = process.env.SHOTS_DIR;

const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);

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
const RPC = `http://127.0.0.1:${port}`;
const anvil = spawn(
  'anvil',
  [
    '--port',
    String(port),
    '--silent',
    '--hardfork',
    'prague',
    '--timestamp',
    String(roundTime(ROUND - 4) - 900),
  ],
  { stdio: 'ignore' },
);
anvil.on('error', (e) => {
  console.error(`cannot start anvil (is Foundry installed?): ${e.message}`);
  process.exit(1);
});
process.on('exit', () => anvil.kill('SIGTERM'));

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
for (let i = 0; ; i++) {
  try {
    await rpc('eth_chainId');
    break;
  } catch (e) {
    if (i > 150) throw e;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------------------------- deploy
const chain = {
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain, transport: http(RPC) });
const [A0, A1, A2] = await rpc('eth_accounts');
const deployer = createWalletClient({ account: A0, chain, transport: http(RPC) });
const artifact = (file, name) =>
  JSON.parse(readFileSync(path.join(REPO, 'contracts/out', file, `${name}.json`), 'utf8'));
async function deploy(file, name, args) {
  const a = artifact(file, name);
  const hash = await deployer.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`deploy ${name} failed`);
  return r.contractAddress;
}
const COORD = await deploy('ArcDrawCoordinator.sol', 'ArcDrawCoordinator', [USDC]);
const ARCPET = await deploy('ArcPet.sol', 'ArcPet', [COORD]);
// Multicall3 runtime code (read-only eth_getCode from Arc mainnet, or MULTICALL3_CODE) at its canonical address.
const mcCode =
  process.env.MULTICALL3_CODE ??
  (
    await (
      await fetch('https://rpc.mainnet.arc.io', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getCode',
          params: [MULTICALL3, 'latest'],
        }),
      })
    ).json()
  ).result;
await rpc('anvil_setCode', [MULTICALL3, mcCode]);
log('deployed coordinator', COORD, 'ArcPet', ARCPET);

// ---------------------------------------------------------------------------------------------- build and serve
function build(env) {
  const r = spawnSync('pnpm', ['build'], { cwd: WEB, encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error('next build failed');
  }
}
const BASE = '/arcpet';
log('building the static export without an address (guard check)');
build({ NEXT_PUBLIC_BASE_PATH: BASE, NEXT_PUBLIC_ARCPET_ADDRESS: '' });
const guardHtml = readFileSync(path.join(WEB, 'out/app/index.html'), 'utf8');
if (!guardHtml.includes('Not deployed yet')) throw new Error('"not deployed yet" guard missing');
log('ok: not-deployed guard in the static HTML');

log('building the static export for chain 31337');
build({
  NEXT_PUBLIC_BASE_PATH: BASE,
  NEXT_PUBLIC_CHAIN_ID: '31337',
  NEXT_PUBLIC_RPC_URL: RPC,
  NEXT_PUBLIC_ARCPET_ADDRESS: ARCPET,
  NEXT_PUBLIC_COORDINATOR_ADDRESS: COORD,
});
const { server, url } = await serveStatic(path.join(WEB, 'out'), { basePath: BASE });
const SITE = `${url}${BASE}`;

// ---------------------------------------------------------------------------------------------- browser
const browser = await chromium.launch();
const consoleErrors = [];
const pages = [];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

async function openAs(account) {
  const context = await browser.newContext({ acceptDownloads: true, locale: 'en-US' });
  await context.route(
    (u) => u.pathname.endsWith(`/public/${ROUND}`),
    (route) => route.fulfill({ json: BEACON }),
  );
  await context.addInitScript(
    ({ account, rpcUrl }) => {
      if (!account) return;
      let id = 0;
      const call = async (method, params) => {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }),
        });
        const body = await res.json();
        if (body.error) throw Object.assign(new Error(body.error.message), body.error);
        return body.result;
      };
      window.ethereum = {
        request: async ({ method, params }) => {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [account];
            case 'eth_chainId':
              return '0x7a69';
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              return null;
            case 'wallet_requestPermissions':
            case 'wallet_getPermissions':
              return [{ parentCapability: 'eth_accounts' }];
            case 'eth_sendTransaction':
              return call(method, [{ ...params[0], from: account }]);
            default:
              return call(method, params);
          }
        },
        on() {},
        removeListener() {},
      };
    },
    { account, rpcUrl: RPC },
  );
  const page = await context.newPage();
  pages.push(page);
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${page.url()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  return page;
}

const see = (page, text, timeout = 20_000) =>
  page.getByText(text, { exact: false }).first().waitFor({ timeout });
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};
async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await page
    .getByText(/^0x[0-9a-fA-F]{4}…/)
    .first()
    .waitFor();
}
async function step(name, fn) {
  await fn();
  log('ok:', name);
}

let failed = false;
try {
  const owner = await openAs(A0);
  await step('owner connects and sees the hatch form', async () => {
    await owner.goto(`${SITE}/app/`);
    await connect(owner);
    await see(owner, 'You have no pet yet');
  });

  await step('invalid name is refused client-side', async () => {
    await owner.getByLabel('Name').fill('<b>');
    await owner.getByRole('button', { name: 'Hatch', exact: true }).click();
    await see(owner, 'Invalid name');
  });

  await step('hatch lays an egg pinned to the fixture round', async () => {
    await rpc('evm_setNextBlockTimestamp', [roundTime(ROUND - 4)]);
    await owner.getByLabel('Name').fill('Mochi');
    await owner.getByRole('button', { name: 'Hatch', exact: true }).click();
    await see(owner, `Waiting for drand round ${ROUND}`);
    await shot(owner, 'egg-waiting');
  });

  await step('"Hatch now" fetches drand, fulfills, and the pet is alive', async () => {
    await rpc('evm_mine', [roundTime(ROUND)]);
    await owner.getByRole('button', { name: 'Hatch now' }).click({ timeout: 30_000 });
    await see(owner, 'Dies in', 40_000);
    await owner.getByRole('meter', { name: 'Hunger' }).waitFor();
    await shot(owner, 'alive');
  });

  await step('.ics reminder downloads', async () => {
    const [download] = await Promise.all([
      owner.waitForEvent('download'),
      owner.getByRole('button', { name: 'Add reminder to calendar' }).click(),
    ]);
    if (download.suggestedFilename() !== 'arcpet-1-reminder.ics') throw new Error('bad .ics name');
    const text = readFileSync(await download.path(), 'utf8');
    if (!text.includes('BEGIN:VALARM') || !text.includes('SUMMARY:Feed Mochi (ArcPet #1)')) {
      throw new Error('bad .ics content');
    }
  });

  const friend = await openAs(A1);
  await step('a second wallet feeds the pet from its public page (R1)', async () => {
    await friend.goto(`${SITE}/app/pet/?id=1`);
    await see(friend, 'Mochi #1');
    await connect(friend);
    await friend.getByRole('button', { name: 'Feed' }).click();
    await see(friend, 'Done', 30_000);
    const logs = await pub.getLogs({
      address: ARCPET,
      event: {
        type: 'event',
        name: 'Fed',
        inputs: [
          { name: 'id', type: 'uint256', indexed: true },
          { name: 'caller', type: 'address', indexed: true },
          { name: 'deathAt', type: 'uint64', indexed: false },
        ],
      },
      fromBlock: 0n,
    });
    if (logs.length !== 1 || logs[0].args.caller.toLowerCase() !== A1.toLowerCase())
      throw new Error('no Fed log');
    await shot(friend, 'public-page');
  });

  const anon = await openAs(null);
  await step('ranking lists the living pet (multicall over ids)', async () => {
    await anon.goto(`${SITE}/app/ranking/`);
    await see(anon, 'Mochi');
    await shot(anon, 'ranking');
  });

  const undertaker = await openAs(A2);
  await step('after its windows pass the pet is dead; a third wallet buries it', async () => {
    const block = await pub.getBlock();
    await rpc('evm_mine', [Number(block.timestamp) + 300_000]);
    await undertaker.goto(`${SITE}/app/pet/?id=1`);
    await connect(undertaker);
    await see(undertaker, 'This pet is dead', 70_000);
    await undertaker.getByRole('button', { name: 'Bury' }).click();
    await see(undertaker, 'Lived', 30_000);
    await shot(undertaker, 'buried');
  });

  await step('graveyard shows the tombstone; PT-BR toggle translates', async () => {
    await anon.goto(`${SITE}/app/graveyard/`);
    await see(anon, 'Mochi');
    await anon.getByRole('button', { name: 'PT-BR' }).click();
    await see(anon, 'Cemitério');
    await shot(anon, 'graveyard-pt');
  });

  await step('owner can hatch again after the death (R6)', async () => {
    await owner.goto(`${SITE}/app/`);
    await see(owner, 'Your last pet is gone');
  });

  const relevant = consoleErrors.filter((e) => !/favicon|Failed to load resource.*404/.test(e));
  if (relevant.length > 0) throw new Error(`console errors:\n${relevant.join('\n')}`);
  log('all good');
} catch (e) {
  failed = true;
  console.error(e);
  for (const [i, p] of pages.entries()) {
    const text = await p.innerText('main').catch(() => '');
    console.error(`--- page ${i} ${p.url()}\n${text.slice(0, 1500)}`);
    await shot(p, `failure-${i}`);
  }
  if (consoleErrors.length) console.error('console errors:\n', consoleErrors.join('\n'));
} finally {
  await browser.close();
  server.close();
  anvil.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
