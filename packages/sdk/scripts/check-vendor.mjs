#!/usr/bin/env node
// Checks that src/vendor/arcdraw/*.ts still match the arc-randomness sources they were copied from (byte for byte
// after the 2-line header). Skips with a notice when the sibling checkout is not present (CI, fresh clones).
//
//   pnpm --filter @arcpet/sdk check:vendor
//   ARCDRAW_SDK_SRC=/path/to/arc-randomness/packages/sdk/src pnpm --filter @arcpet/sdk check:vendor
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendorDir = resolve(here, '../src/vendor/arcdraw');
const upstream = process.env.ARCDRAW_SDK_SRC ?? resolve(here, '../../../../arc-randomness/packages/sdk/src');

if (!existsSync(upstream)) {
  console.log(`arc-randomness sources not found at ${upstream}; skipping vendor check`);
  process.exit(0);
}

let drift = 0;
for (const file of readdirSync(vendorDir).filter((f) => f.endsWith('.ts'))) {
  const body = readFileSync(resolve(vendorDir, file), 'utf8').split('\n').slice(2).join('\n');
  const source = readFileSync(resolve(upstream, file), 'utf8');
  if (body !== source) {
    console.error(`src/vendor/arcdraw/${file} differs from ${resolve(upstream, file)}`);
    drift++;
  }
}
if (drift > 0) process.exit(1);
console.log('src/vendor/arcdraw matches arc-randomness');
