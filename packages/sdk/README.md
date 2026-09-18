# @arcpet/sdk

TypeScript SDK for [ArcPet](../../README.md). Spec: [docs/SPEC.md](../../docs/SPEC.md).

## TL;DR

```sh
pnpm --filter @arcpet/sdk build
pnpm --filter @arcpet/sdk test          # vitest: parity with Solidity, state, ics, hatch, multicall listing
pnpm contracts:abi                      # regenerate src/abi/*.ts from contracts/out (check: pnpm sdk:check-abi)
pnpm contracts:vectors                  # regenerate test/fixtures/parity.json from the real Solidity
pnpm --filter @arcpet/sdk e2e:anvil     # local anvil only: hatch -> fulfill -> feed -> list, and the claimGenes path
pnpm --filter @arcpet/sdk check:vendor  # vendored ArcDraw files still match ../arc-randomness (skips if absent)
```

## What is in it

| Module | Exports |
|---|---|
| `pet.ts` | TS mirror of `PetLib.sol`: `decodeGenes`, `statAt`, `deathAt`, `moodOf`, `isValidName`; `Status`, `Mood`; Zod `PetInfoSchema` |
| `state.ts` | Mirror of `ArcPet.petInfo`'s derived fields: `petStateAt(raw, t)`, `livePet(info, t)`, `isAliveAt`, `statBelowAt` (when a pet turns Hungry/Sad), `secondsToDeath`, `rankOldestAlive`, `graveyard` |
| `pets.ts` | Reads: `readPet`, `readPetOf`, `readTotalSupply`, `listPets` (ids `1..totalSupply` via chunked Multicall3, R5), `readTokenMetadata` / `decodeTokenUri` |
| `hatch.ts` | Hatch flow: `sendHatch(name)` (returns the hash at broadcast, for UIs) or `hatch(name)` (waits for the receipt, for scripts) -> `parseEggLaid` -> `readHatchStatus` / `hatchPhase` (`waitingRound`, `fulfillable`, `claimable`, `hatched`) -> `fulfillEgg` (drand signature + `coordinator.fulfill`) -> `claimGenes` fallback (R2); `sendPetAction` for feed/play/bury |
| `ics.ts` | `buildReminderIcs`: RFC 5545 event starting at `deathAt - 6h` (or `now + 60 s` when less is left, so the alarm is never in the past; `reminderStart` returns null when it is too late) with a display alarm (D13) |
| `chain.ts` | `arcMainnet` (with Multicall3), `deployedAddress` (zero/placeholder guard), `resolveDeployment` (Zod over `deployments/arc-mainnet.json`) |
| `errors.ts` | `revertErrorName`, `isUserRejection` |
| `abi/` | Generated: `arcPetAbi`, `arcDrawCoordinatorAbi` (from the vendored `IArcDrawCoordinator.sol`) |

## ArcDraw SDK: vendored, not linked

`src/vendor/arcdraw/{constants,drand,errors,rounds,gas,derive}.ts` are byte-for-byte copies of
`arc-randomness@ad0cc79 packages/sdk/src/` with a 2-line header (same pattern as `contracts/src/vendor/arcdraw`).

Why vendoring instead of `link:`/`file:` to `../arc-randomness/packages/sdk` or a published package:

| Option | Problem |
|---|---|
| `link:` / `file:` path | Breaks every checkout that is not this exact folder layout: GitHub Actions (Pages build) checks out only `arcpet`, so `pnpm install --frozen-lockfile` fails. `file:` also needs the sibling's `dist/` built first |
| npm package | `@arcdraw/sdk` is not published; publishing is out of scope (and a release gate for another repo) |
| **vendor (chosen)** | Self-contained, reproducible, pinned to a commit, drift is detectable (`check:vendor`). Cost: ~350 lines copied, two deps (`@noble/curves`, `@noble/hashes`, same versions as upstream) |

Only the browser-fulfill pieces are copied (drand fetch + BLS verification, round math, fulfill gas bound); the
ArcDraw client itself is not needed because ArcPet's flow is two calls (`getRequest`, `fulfill`).

## Parity with Solidity

`contracts/script/SdkVectors.s.sol` runs PetLib and a scripted pet life (egg, hatch, feed/play, death, bury) through the
real contracts in a local script VM and writes `test/fixtures/parity.json`. `test/parity.test.ts` checks every vector:
gene decoding (64), `statAt` edge cases (120), `deathAt` (60), all 125 mood combinations, name rules, and 30
`petInfo` snapshots reproduced by `petStateAt(raw, asOf)`. Rerun `pnpm contracts:vectors` after changing `PetLib.sol`
or `ArcPet.petInfo`.
