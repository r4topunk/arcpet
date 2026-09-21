# DoraHacks BUIDL submission: Arc Microgrants

Paste-ready fields for https://dorahacks.io/hackathon/arc-microgrants. Deadline: **2026-10-14 23:59 ET**.
The form keeps no draft (fill every field in one sitting) and its dropdowns linger from a previous attempt
(re-check each one before submitting). See [CHECKLIST.md](CHECKLIST.md).
Lines starting with `TODO(owner):` still need the owner. Find them with `grep -n "TODO(owner)" SUBMISSION.md`.
Everything else below is filled from the repo and Arc mainnet (chain id 5042) as of 2026-09-18. This is a separate
submission from ArcDraw (https://dorahacks.io/buidl/48845): ArcPet is a distinct product that uses ArcDraw as its
randomness source.

## Name

ArcPet

## One-liner (≤ 100 chars)

An onchain tamagotchi on Arc: genes from verified drand randomness, permanent death, open care.

## Description (≤ 300 words)

ArcPet is an onchain tamagotchi on Arc mainnet. You hatch a pet, keep it fed and happy, and if nobody cares for it,
it dies for good and becomes a tombstone with its age frozen.

- **Hatch.** `hatch(name)` mints a free, soulbound ERC-721 egg (one living pet or egg per wallet) and requests
  randomness from ArcDraw with bounty 0. The pet page fetches the pinned drand quicknet round and anyone can
  fulfill it from the browser. ArcDraw verifies the BLS signature onchain and calls ArcPet back; the delivered value
  becomes the pet's genes: species, palette, eyes, and ±20% on its hunger and play windows. Nobody, not even the
  owner, knows the genes before hatching, and anyone can recompute them from the drand signature and request id.
- **Care.** Hunger empties in about 24 hours and happiness in about 48. Nothing decays in storage: the contract keeps
  `lastFed` and `lastPlayed`, and hunger, happiness, mood and `deathAt` are pure functions of `block.timestamp`, so
  no keeper is needed. Anyone can feed or play with any pet, so care is social.
- **Death.** It is permanent. Once `deathAt` passes, anyone can `bury` the pet, which freezes its tombstone.
- **Art.** `tokenURI` is an onchain SVG built from genes and mood.

ArcPet is a production consumer of ArcDraw. It inherits `ArcDrawConsumer`, fits its callback in 51,563 gas of a
100k limit, and ships `claimGenes`, because the coordinator swallows a failed callback but still marks the request
fulfilled. Eggs never expire.

The contract has no owner, no upgrade, no pause and no `payable`, and holds no USDC. Minting is free, there is no
prize and pets cannot be transferred: nothing to win or sell, so it is not gambling.

Live and Sourcify-verified: three named pets hatched through ArcDraw, one fed by another wallet. MIT licensed.

## How Arc is used

Arc has no native onchain randomness (`PREVRANDAO` is 0), so ArcPet gets its genes from ArcDraw, which verifies
drand quicknet signatures with Arc's EIP-2537 BLS12-381 precompiles. No oracle key is involved at any step. Gas is
paid in USDC, so the cost of keeping a pet alive is in dollars: measured execution gas is 11,409 for `feed` and
11,381 for `play`, and the README estimates about 0.045 USDC per month for one pet. Players pay their own gas, with
no paymaster, relayer or keeper. Arc's sub-second deterministic finality means a hatch or a `feed` is final on
inclusion, and a fulfill lands a few seconds after the pinned round, with no reorg handling. The contract never
touches USDC: it is a pure game-state contract, and the only value that moves is gas.

## What is built

- `ArcPet.sol`: a soulbound ERC-721 (ERC-5192) and `ArcDrawConsumer`, with `hatch`, `feed`, `play`, `bury`,
  `claimGenes`, `petInfo` and an onchain SVG/JSON `tokenURI` (`PetRenderer`), with gene, decay, mood and name
  rules in `PetLib`. It is immutable and its constructor takes only the coordinator address.
- Foundry tests: unit, fuzz, invariant (dead never revives, at most one living pet per wallet, genes never
  overwritten, holds no funds), renderer size and escaping, and deploy-script checks. They also include
  real-coordinator tests: the vendored ArcDraw coordinator with real drand quicknet signatures, covering a callback
  that reverts or runs out of gas followed by `claimGenes`, a refunded request that still hatches, and a batch
  hatch. There are also three read-only mainnet fork tests.
- `@arcpet/sdk`: a TypeScript mirror of the gene and decay math (parity vectors against the contract), Zod types,
  a multicall listing, hatch → fulfill → `claimGenes` helpers, and an `.ics` reminder.
- `apps/web`: a static Next.js app (EN/PT-BR) with my pet (live bars), hatch, `/app/pet/?id=N`, oldest alive and a
  graveyard. The ranking uses multicall over sequential ids, with no indexer.
- Docs: a behaviour spec (`docs/SPEC.md`), a threat model (`docs/THREATS.md`) and a gas snapshot
  (`contracts/snapshots/ArcPetGas.json`).
- Test counts from a real run on 2026-09-18: `forge test` 98 passed, 0 failed, and 3 skipped (the mainnet fork
  tests, which run with `ARC_FORK_TESTS=true`). `@arcpet/sdk` vitest: 98 passed.

Measured execution gas (Foundry snapshot): `feed` 11,409; `play` 11,381; `bury` 31,407; ArcDraw callback 51,563
(limit 100,000); `claimGenes` 62,218; `hatch` 208,010 for a new wallet in steady state (247,210 when the supply and
coordinator counters are still zero); `hatch` with auto-bury of a dead pet 198,611.

## Tech stack

- **Chain:** Arc mainnet (chain id 5042), USDC gas, EIP-2537 BLS12-381 precompiles (through ArcDraw)
- **Randomness:** ArcDraw coordinator `0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324`, drand quicknet (League of
  Entropy)
- **Contracts:** Solidity 0.8.30 (EVM target `prague`), Foundry (unit, fuzz, invariant, real-coordinator,
  read-only mainnet fork), immutable (no owner, no upgrade, no pause), onchain SVG
- **SDK:** TypeScript, viem, Zod, @noble/curves, tsup, Vitest
- **Web:** Next.js 16 (static export), React 19, wagmi 3, Tailwind CSS 4, EN/PT-BR
- **Tooling:** pnpm workspaces, Biome
- **License:** MIT

## Links

| Field | Value |
|---|---|
| Live link (project page) | https://r4topunk.github.io/arcpet/ |
| Public repo | https://github.com/r4topunk/arcpet |
| Hosted dApp (`apps/web`: my pet, hatch, pet page, oldest alive, graveyard) | https://r4topunk.github.io/arcpet/app/ (reads the mainnet contract) |
| ArcPet contract | https://explorer.arc.io/address/0xe61E479900E9D7e1BF67C69a81f1c91419Fd897d |
| Source verification (Sourcify, exact match: runtime and creation) | https://repo.sourcify.dev/5042/0xe61E479900E9D7e1BF67C69a81f1c91419Fd897d |
| Randomness used (ArcDraw: repo, page, BUIDL) | https://github.com/r4topunk/arcdraw · https://r4topunk.github.io/arcdraw/ · https://dorahacks.io/buidl/48845 |
| Demo video | Optional (the program rules do not require one); if recorded later, a YouTube unlisted or Loom URL |
| Builder profile (GitHub / X / Farcaster) | https://github.com/r4topunk (add an X or Farcaster URL if you want one listed) |

## Team

r4to ([r4topunk](https://github.com/r4topunk)): solo builder (contracts, SDK, web). Researcher/builder in AI agents and Ethereum; also built ArcDraw, ArcPull and MemoKit for this program.

TODO(owner): confirm or edit the line above (the form may already hold it from earlier BUIDLs).

## Grant and next milestones

The microgrant is a fixed 500 USDC. This is a distinct project from the author's ArcDraw submission, which it
consumes as a dependency.

TODO(owner): confirm whether the form asks for use of funds or milestones. If it does, split the 500 USDC across the
items below yourself; no amounts are proposed here.

Candidate milestones, taken from the v2 options in the plan (`PLAN-ARCPET.md`):
1. A death reminder by web push or Telegram that reads `deathAt`. v1 ships an `.ics` calendar event, with no server.
2. Free random events (illness, visits) drawn through ArcDraw.
3. Breeding: two living pets produce an egg with mixed genes plus ArcDraw randomness.
4. A "letter to the future" with ArcSeal timelock encryption: the owner seals a message that opens on the pet's
   30-day birthday or at its burial.

## Mainnet deployment

| Contract | Address | Deploy tx | Block | Verified |
|---|---|---|---|---|
| ArcPet | [0xe61E…897d](https://explorer.arc.io/address/0xe61E479900E9D7e1BF67C69a81f1c91419Fd897d) | [0xdecf…5921](https://explorer.arc.io/tx/0xdecfdb741592a99aed74818c559c2d238fc1c68800d6d40f5cf35fe758da5921) | 21513700 | [Sourcify exact match](https://repo.sourcify.dev/5042/0xe61E479900E9D7e1BF67C69a81f1c91419Fd897d) (runtime + creation) |
| ArcDrawCoordinator (external, not part of this submission) | [0x3cfD…0324](https://explorer.arc.io/address/0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324) | see the ArcDraw BUIDL | 21338070 | Sourcify exact match |

Deployer: `0x39a7B6fa1597BB6657Fe84e64E3B836c37d6F75d`. Constructor argument: the coordinator address only.

## Mainnet proof transactions

This is the same data as `demo` in `deployments/arc-mainnet.json` and the README's demo table, which is the live
source of proof hashes: https://github.com/r4topunk/arcpet#demo-transactions-d17. Pets: #1 "Arcturus" (main wallet), #2 "Bolt" (wallet B) and #3 "Cinder" (wallet C),
all hatched through ArcDraw with genes on chain. Pet #3 was left alone on purpose: Cinder's `deathAt` passed at
2026-09-19 17:23 UTC and wallet B buried it 18 minutes later, at 17:41 UTC. All six proofs are sent and have
status `success`.

| # | Proof | Tx |
|---|---|---|
| 1 | Hatch main pet "Arcturus" (#1): mint soulbound egg + `requestRandomness` (bounty 0) | [0xf4e4…8052](https://explorer.arc.io/tx/0xf4e4ed6e21316b23071135950fa784933ca2eb6659a67250350467cda6688052) |
| 2 | Hatch pet "Bolt" (#2) from wallet B | [0x5939…5694](https://explorer.arc.io/tx/0x59395db2dbc424ff3b82e1fc8eb7969002336637d49b07aaf12d29cf8c5b5694) |
| 3 | Hatch pet "Cinder" (#3) from wallet C | [0xa495…dd4b](https://explorer.arc.io/tx/0xa4958dae7f5a30af308421cbca6ff0f040574cf19a65f4b36515e1638168dd4b) |
| 4 | Fulfill through the ArcDraw coordinator: drand quicknet BLS verified onchain, callback hatches #1 | [0xc25b…922f](https://explorer.arc.io/tx/0xc25b2cafacdd289896af039e4bb2e560107167d4b73080e2a7373121fbf5922f) |
| 4b | Fulfill for #2 and #3 (same path) | [0x697b…b2be](https://explorer.arc.io/tx/0x697b20fff22e953cc0415926001ab1b9cb7a5adecd5a322214ec80c94452b2be) · [0x4107…c7e8](https://explorer.arc.io/tx/0x4107f04036f3c99ddd738e3a0594fc063fbb2dde114e0ca20a55812fe047c7e8) |
| 5 | Social care: wallet B feeds C's pet (#3) | [0x88d6…d6e7](https://explorer.arc.io/tx/0x88d6128b3da61e5f87cc18ca9cf197985d89d425c20f51a6fa3140f6feb0d6e7) |
| 6 | Permanent death: #3 died at `deathAt` (2026-09-19 17:23 UTC) and wallet B buried it at 17:41 UTC (permissionless `bury`, final age 26h 37m) | [0x0bfa…924d](https://explorer.arc.io/tx/0x0bfa8ebb9456b9cf20605861f6535e7a12669371ebe208b5d8cd9ae9fdea924d) |

Definition of done (PLAN-ARCPET D17): three named pets hatched, one pet fed by a third party, one pet dead and buried
by a third party. All six proofs have status `success` on `https://explorer.arc.io`; #6 closed the loop on
2026-09-19. The three demo pets have since died (#2 on 2026-09-19, #1 on 2026-09-20): nothing keeps a pet alive
but someone choosing to feed it.

## Demo video script (2:00)

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Project page hero, then a live pet with its hunger and happiness bars | "ArcPet is a tamagotchi that lives on Arc. If nobody feeds it, it dies, for good." |
| 0:15–0:40 | `/app/` hatch with a name, then the browser fulfilling the drand round, then the egg hatching | "Hatching is free. The genes come from ArcDraw: a drand round a few seconds in the future, verified onchain with Arc's BLS precompiles. Nobody knows the genes in advance, not even me." |
| 0:40–1:00 | Pet page `/app/pet/?id=3` from wallet B, clicking Feed, then the `feed` tx on the explorer | "Anyone can feed or play with any pet. Here Bolt's owner feeds Cinder. Nothing decays in storage: the state is a pure function of time, so no keeper is needed." |
| 1:00–1:25 | Cinder's page showing Dead after `deathAt`, then B's `bury` tx, then the graveyard | "Nobody fed Cinder again. Once the time passed, it died, and any wallet can bury it. The tombstone keeps its age forever." |
| 1:25–1:45 | ArcPet on the explorer and its Sourcify exact match, then `tokenURI` rendered in a wallet or explorer | "The art is an onchain SVG, and the contract has no owner, no upgrade and no USDC. If the ArcDraw callback ever fails, `claimGenes` finishes the hatch from the coordinator." |
| 1:45–2:00 | Oldest-alive ranking, then the repo | "No paid mint, no prize, no transfers: it's a game, not a bet. MIT-licensed, and live on Arc mainnet." |

Recording tips: record at 1920×1080 and cut the wait between request and fulfill. The 1:00–1:25 segment uses the
real death and bury of #3 (2026-09-19), not a staged one. The three demo pets are now dead, so the 0:00–0:15 and
1:45–2:00 segments need a freshly hatched pet.

## Before pasting

- [x] ArcPet deployed and Sourcify-verified (exact match: runtime and creation)
- [x] Public repo, project page and `/arcpet/app/` open (HTTP 200 on 2026-09-18)
- [x] Proofs #1–#6 have status `success` on mainnet
- [ ] TODO(owner): confirm the team line (the Team section above)
- [ ] TODO(owner): use-of-funds / milestones field checked against the live form
- [ ] README status line ("live on Arc mainnet") and the ArcDraw repo link fixed locally; push before submitting
- [x] Proof #6 (bury by wallet B, 2026-09-19 17:41 UTC) recorded in the README demo table and in
  `demo.buryByThirdPartyTx` in `deployments/arc-mainnet.json` ([CHECKLIST.md](CHECKLIST.md))
- [ ] Not blocking: demo video (optional) and an X/Farcaster profile
