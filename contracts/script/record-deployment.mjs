#!/usr/bin/env node
// Records the ArcPet deployment from Foundry's broadcast log into deployments/arc-mainnet.json.
// Reads only local files (no RPC, no keys). Other fields (external, demo) are kept; `verified` is kept when the
// address did not change and reset to false otherwise (set it to true after Sourcify confirms).
//
//   node script/record-deployment.mjs                                  # from contracts/
//   node script/record-deployment.mjs --broadcast <run.json> --out <deployments.json>
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHAIN_ID = 5042;
const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(here, '..');
const repoDir = resolve(contractsDir, '..');

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const broadcastFile = resolve(
  option('--broadcast') ?? resolve(contractsDir, 'broadcast/Deploy.s.sol', String(CHAIN_ID), 'run-latest.json'),
);
const outFile = resolve(option('--out') ?? resolve(repoDir, 'deployments/arc-mainnet.json'));

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!existsSync(broadcastFile)) fail(`no broadcast log at ${broadcastFile}; run forge script ... --broadcast first`);
const run = JSON.parse(readFileSync(broadcastFile, 'utf8'));
if (Number(run.chain) !== CHAIN_ID) fail(`broadcast chain ${run.chain} is not Arc mainnet (${CHAIN_ID})`);

const tx = run.transactions.find((t) => t.contractName === 'ArcPet' && t.transactionType?.startsWith('CREATE'));
if (!tx) fail('no ArcPet creation in the broadcast log');
const receipt = run.receipts.find((r) => r.transactionHash === tx.hash);
if (!receipt || receipt.status !== '0x1') fail(`missing or failed receipt for ${tx.hash}`);

const base = JSON.parse(readFileSync(outFile, 'utf8'));
const coordinator = base.external?.ArcDrawCoordinator?.address ?? '';
const [coordArg] = tx.arguments ?? [];
if (coordArg && coordArg.toLowerCase() !== coordinator.toLowerCase())
  fail(`ArcPet was deployed with coordinator ${coordArg}, deployments file says ${coordinator}`);

let commit = null;
try {
  commit = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {}

const previous = base.contracts?.ArcPet ?? {};
const sameAddress = (previous.address ?? '').toLowerCase() === tx.contractAddress.toLowerCase();
base.contracts = base.contracts ?? {};
base.contracts.ArcPet = {
  ...previous,
  address: tx.contractAddress,
  deployBlock: Number(BigInt(receipt.blockNumber)),
  deployTx: tx.hash,
  verified: sameAddress ? (previous.verified ?? false) : false,
  deployer: tx.transaction?.from ?? null,
  commit,
};

const tmp = `${outFile}.tmp`;
writeFileSync(tmp, `${JSON.stringify(base, null, 2)}\n`);
renameSync(tmp, outFile);
console.log(`recorded ArcPet ${tx.contractAddress} (block ${base.contracts.ArcPet.deployBlock}) -> ${outFile}`);
