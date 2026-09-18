# ArcPet

An onchain tamagotchi on [Arc](https://arc.io). Hatch a pet whose genes are drawn by
[ArcDraw](https://github.com/r4topunk/arc-randomness) (drand quicknet, BLS-verified onchain), keep it fed and happy,
and if nobody cares for it, it dies for good and becomes a tombstone with its age frozen.

- Soulbound ERC-721, free to hatch, one living pet (or egg) per wallet.
- Hunger empties in ~24h, happiness in ~48h (+-20% by genes). Anyone can feed or play with any pet.
- No keeper, no owner, no USDC in the contract. Players pay their own gas (~0.045 USDC/month per pet).
- Production consumer of ArcDraw.

Status: contract, renderer, SDK and web app built and tested. **Mainnet deployment pending** (see
[CHECKLIST.md](CHECKLIST.md)). Behaviour spec: [docs/SPEC.md](docs/SPEC.md). Threat model: [docs/THREATS.md](docs/THREATS.md).

## How it works

```
hatch(name) ──▶ Egg ──(ArcDraw fulfill: callback writes genes)──▶ Alive ──(now >= deathAt)──▶ Dead ──bury──▶ Buried
                 │  never decays or expires                         ▲ feed / play (anyone)
                 └─(callback failed but request Fulfilled)─ claimGenes ┘
```

| Piece | What it does |
|---|---|
| `hatch(name)` | Mints a soulbound egg and calls `coordinator.requestRandomness(100k gas, bounty 0)`, which pins a drand round ~12 s ahead |
| Fulfill | Any browser fetches that round's drand signature and calls `coordinator.fulfill`. The coordinator verifies BLS onchain and calls ArcPet back with `keccak256(abi.encode(sha256(sig), chainid, coordinator, requestId))`, which becomes the pet's `genes` |
| `claimGenes(id)` | If the callback failed, the coordinator still marks the request Fulfilled; anyone can finish the hatch from `getRequest(id).randomness` |
| Genes | species (4), palette (8), eyes (4), hunger and play windows (+-20%). See SPEC §4 |
| Decay | Nothing is stored but `lastFed` / `lastPlayed`: hunger, happiness, mood and `deathAt = min(lastFed + TH, lastPlayed + TP)` are pure functions of `block.timestamp` |
| Death | Permanent. `bury(id)` (anyone) freezes the tombstone; the owner hatching again buries the old pet automatically |
| Art | `tokenURI` is an onchain SVG built from genes + mood; tombstones show name and age |
| Reminder | The app downloads an `.ics` calendar event 6h before `deathAt` (no server, no notifications backend) |

### ArcDraw showcase

ArcPet is the production consumer of ArcDraw and exercises every path of the coordinator on mainnet:

- `requestRandomness` with bounty 0 (no USDC approval), fulfilled from the browser by whoever opens the pet page.
- The callback contract pattern (`ArcDrawConsumer`), with a gas budget checked by tests (callback < 100k).
- The failure path: a swallowed callback still marks the request Fulfilled; `claimGenes` reads `getRequest().randomness`.
- Eggs never expire: `fulfill` accepts Pending **and** Refunded requests, and drand signatures are public forever.
- Genes are verifiable offline: drand round signature + `requestId` reproduce them exactly.

## Layout

| Part | Path |
|---|---|
| Contract (soulbound ERC-721 + ArcDraw consumer, onchain SVG), deploy script | `contracts/` |
| SDK: state math mirror, multicall listing, hatch -> fulfill -> claimGenes, .ics | [`packages/sdk`](packages/sdk/README.md) |
| Web app: my pet (live bars), hatch, `/app/pet/?id=N`, oldest alive, graveyard, EN/PT-BR | `apps/web` |
| Project page | `site/index.html` |
| Addresses and demo tx hashes | [`deployments/arc-mainnet.json`](deployments/arc-mainnet.json) |

## Run it

Requirements: Node >= 22, pnpm, Foundry.

```sh
pnpm install
pnpm build                                    # forge build + sdk + web static export
pnpm test                                     # forge test + vitest
pnpm check                                    # build + test + typecheck + lint + forge fmt + ABI drift + gas snapshot
pnpm --filter @arcpet/web dev                 # http://localhost:3000/app/ ("not deployed yet" until the address is set)
pnpm --filter @arcpet/web e2e:anvil           # full browser flow against a throwaway local anvil
ARC_FORK_TESTS=true pnpm contracts:test       # read-only fork tests against the real ArcDraw coordinator
```

## Deploy (owner only)

Placeholders only; never put a private key in a file or env. The step-by-step list is in [CHECKLIST.md](CHECKLIST.md).

```sh
cd contracts
# 1. simulate (sends nothing): checks chain 5042, the coordinator address in deployments/arc-mainnet.json,
#    that it has code and accepts ArcPet's 100k callback gas
forge script script/Deploy.s.sol --rpc-url arc --account [KEYSTORE] --sender [DEPLOYER_ADDRESS]
# 2. deploy + verify on Sourcify
forge script script/Deploy.s.sol --rpc-url arc --account [KEYSTORE] --sender [DEPLOYER_ADDRESS] \
  --broadcast --verify --verifier sourcify
# 3. record address, block and tx into deployments/arc-mainnet.json (reads the local broadcast log only)
node script/record-deployment.mjs
# 4. if --verify did not finish: forge verify-contract [ARCPET_ADDRESS] src/ArcPet.sol:ArcPet --chain 5042 \
#      --verifier sourcify --constructor-args $(cast abi-encode "c(address)" 0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324)
```

Then set `"verified": true` in the JSON once Sourcify shows the match, and rebuild the web app (it reads the address
from the JSON, or from `NEXT_PUBLIC_ARCPET_ADDRESS`).

## Deployment (Arc mainnet, chain 5042)

| Contract | Address | Verified |
|---|---|---|
| ArcPet | [`0xe61e479900e9d7e1bf67c69a81f1c91419fd897d`](https://explorer.arc.io/address/0xe61e479900e9d7e1bf67c69a81f1c91419fd897d) | yes (Sourcify exact match) |
| ArcDrawCoordinator (external) | `0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324` | yes |

### Demo transactions (D17)

| Step | Tx |
|---|---|
| Hatch main pet ("Arcturus", #1) | [`0xf4e4ed6e…`](https://explorer.arc.io/tx/0xf4e4ed6e21316b23071135950fa784933ca2eb6659a67250350467cda6688052) |
| Hatch pet B ("Bolt", #2) | [`0x59395db2…`](https://explorer.arc.io/tx/0x59395db2dbc424ff3b82e1fc8eb7969002336637d49b07aaf12d29cf8c5b5694) |
| Hatch pet C ("Cinder", #3) | [`0xa4958dae…`](https://explorer.arc.io/tx/0xa4958dae7f5a30af308421cbca6ff0f040574cf19a65f4b36515e1638168dd4b) |
| Fulfill via ArcDraw (drand quicknet, callback hatches #1) | [`0xc25b2caf…`](https://explorer.arc.io/tx/0xc25b2cafacdd289896af039e4bb2e560107167d4b73080e2a7373121fbf5922f) |
| B feeds C's pet (social care) | [`0x88d6128b…`](https://explorer.arc.io/tx/0x88d6128b3da61e5f87cc18ca9cf197985d89d425c20f51a6fa3140f6feb0d6e7) |
| C's pet dies, B buries it | `TBD` |

Site: https://r4topunk.github.io/arcpet/

## Credits

Randomness: drand League of Entropy (quicknet) via ArcDraw.

## License

MIT
