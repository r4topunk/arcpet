# AGENTS.md: ArcPet

Onchain tamagotchi on Arc (soulbound ERC-721, ArcDraw genes, permanent death). Everything in English.

## TL;DR

```sh
pnpm install && pnpm build && pnpm test
pnpm contracts:abi      # after any ABI change (SDK ABI drift is checked by `pnpm check`)
```

Source of truth: `../PLAN-ARCPET.md` (decisions D1-D17, R1-R9, final) -> `docs/SPEC.md` (behaviour) ->
`contracts/src/interfaces/IArcPet.sol` (ABI) + `contracts/src/libraries/PetLib.sol` (genes, decay, mood, names).

## Layout

| Path | What |
|---|---|
| `contracts/src/ArcPet.sol` | Soulbound ERC-721 + ArcDrawConsumer |
| `contracts/src/PetRenderer.sol` | internal library: PetInfo -> tokenURI (SVG bitmask) |
| `contracts/src/libraries/PetLib.sol` | the only implementation of gene layout / decay / mood / name rules |
| `contracts/script/Deploy.s.sol` + `record-deployment.mjs` | mainnet deploy (owner runs it; see README / CHECKLIST.md) and JSON recording |
| `contracts/src/vendor/arcdraw/` | vendored ArcDraw consumer + interfaces. **Do not edit** |
| `packages/sdk` | `@arcpet/sdk`: TS mirror of PetLib/petInfo, Zod types, generated ABIs, multicall listing, hatch/fulfill/claimGenes, .ics. `src/vendor/arcdraw/` is vendored from arc-randomness: **do not edit** |
| `apps/web` | Next.js static export (`/app/`, `/app/pet/?id=N`, `/app/ranking/`, `/app/graveyard/`), EN/PT-BR |
| `site/index.html` | project page, copied over the export root by `.github/workflows/pages.yml` |
| `deployments/arc-mainnet.json` | coordinator address, ArcPet address (after deploy), demo tx hashes |

## Hard rules

1. Never deploy, broadcast or send transactions (mainnet or testnet). Fork tests are read-only.
2. Never read, print or store private keys, seeds or `.env` files. Deploys use a Foundry keystore (`--account`).
3. No `git push`, `npm publish`, hosting deploys or repo creation. The owner does these.
4. Contract: immutable, no owner, no pause, no `payable`, no USDC. Do not change D1-D17 / R1-R9.
5. Any change to gene/decay/mood/name math goes in `PetLib.sol` **and** `packages/sdk/src/pet.ts` (+ `state.ts` for
   `petInfo`) in the same change, then `pnpm contracts:vectors` so the parity tests see it.
6. `e2e:anvil` scripts (sdk, web) run only against a throwaway local anvil they spawn themselves.
