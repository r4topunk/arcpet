# ArcPet technical spec

> Implementation spec for [`PLAN-ARCPET.md`](../../PLAN-ARCPET.md) rev. 2. Decisions D1-D17 and revisions R1-R9 are
> final; this file says how they are built, it does not reopen them.
> ABI source of truth: [`contracts/src/interfaces/IArcPet.sol`](../contracts/src/interfaces/IArcPet.sol).
> Math source of truth: [`contracts/src/libraries/PetLib.sol`](../contracts/src/libraries/PetLib.sol) (mirrored in
> `packages/sdk/src/pet.ts`). If code and spec disagree, fix one of them in the same change and say why.

## TL;DR

```sh
pnpm install
pnpm build            # forge build + sdk + web
pnpm test             # forge test + vitest
pnpm contracts:abi    # regenerate packages/sdk/src/abi/ArcPet.ts after any ABI change
pnpm check            # build + test + typecheck + lint + forge fmt + ABI drift + gas snapshot
```

- One immutable contract, `ArcPet` (soulbound ERC-721 + `ArcDrawConsumer`), plus the internal library
  `PetRenderer` (SVG/JSON) and the shared library `PetLib` (genes, decay, mood, names).
- No owner, no pause, no USDC, no `payable`. Constructor takes only the ArcDraw coordinator address.
- Stats are never stored: storage keeps `lastFed` and `lastPlayed`, and every view derives hunger, happiness and death
  from `block.timestamp`.

## 1. Glossary

| Term | Meaning |
|---|---|
| TH / `hungerWindow` | seconds for hunger to go 100 -> 0. Base 24h, genes +-20% |
| TP / `playWindow` | seconds for happiness to go 100 -> 0. Base 48h, genes +-20% |
| `deathAt` | `min(lastFed + TH, lastPlayed + TP)` |
| current pet | `petOf(owner)`: the wallet's most recent pet id, any status |
| coordinator | ArcDraw coordinator, Arc mainnet `0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324` |

## 2. State machine

```
            hatch(name)                 callback / claimGenes           now >= deathAt            bury / owner's hatch
  None ─────────────────▶ Egg ─────────────────────────────▶ Alive ───────────────────▶ Dead ──────────────────────▶ Buried
                          │ never decays                     ▲  │ (pure function of time,     │ (view fact:          (diedAt = deathAt,
                          │ never expires (R8)   feed / play │  │  no tx)                     │  feed/play revert)    frozen forever)
                          └─ stays Egg until genes           └──┘ any caller (R1/D7)
```

Status is derived, never stored as an enum:

| Status | Condition (evaluated at `t`) |
|---|---|
| `Egg` | `bornAt == 0` |
| `Alive` | `bornAt != 0 && diedAt == 0 && t < deathAt` |
| `Dead` | `bornAt != 0 && diedAt == 0 && t >= deathAt` |
| `Buried` | `diedAt != 0` |

### 2.1 Transitions and access

| Function | Caller | Requires (else revert) | Effects | Event |
|---|---|---|---|---|
| `hatch(name)` | owner-to-be (msg.sender) | `PetLib.isValidName(name)` (`InvalidName`); current pet is None, Dead or Buried (`AlreadyHasPet(owner, id)` if Egg or Alive) | if current pet Dead: bury it first (R6). Mint id = `totalSupply + 1` to msg.sender, `laidAt = now`; `coordinator.requestRandomness(100_000, 0)`; map `requestId -> id`; `petOf[msg.sender] = id` | (`Died`), `Transfer(0, owner, id)`, `Locked(id)`, `EggLaid` |
| callback `_fulfillRandomness(reqId, r)` | coordinator only (base contract) | **never reverts**: unknown `reqId` or pet not Egg -> return silently | `_hatch(id, r, viaClaim=false)` | `Hatched` |
| `claimGenes(id)` | anyone | exists (`NonexistentPet`); Egg (`AlreadyHatched`); `coordinator.getRequest(requestId).status == Fulfilled` (`RequestNotFulfilled(id, reqId, status)`) | `_hatch(id, getRequest(reqId).randomness, viaClaim=true)` | `Hatched` |
| `feed(id)` | anyone (R1) | exists; hatched (`NotHatched`); `now < deathAt` (`PetDead(id, deathAt)`) | `lastFed = now` | `Fed(id, caller, newDeathAt)` |
| `play(id)` | anyone (R1) | same as feed | `lastPlayed = now` | `Played(id, caller, newDeathAt)` |
| `bury(id)` | anyone | exists; hatched (`NotHatched`); `diedAt == 0` (`AlreadyBuried`); `now >= deathAt` (`NotDead(id, deathAt)`) | `diedAt = deathAt` | `Died(id, msg.sender, diedAt, diedAt - bornAt)` |
| transfer/approve (5 fns) | anyone | always revert `Soulbound()` | - | - |

`_hatch(id, r, viaClaim)`: `genes = r`; `hungerWindow = PetLib.hungerWindow(r)`; `playWindow = PetLib.playWindow(r)`;
`bornAt = lastFed = lastPlayed = block.timestamp`. Emits `Hatched(id, genes, bornAt, deathAt, viaClaim)`.
Must fit in ~70k gas (callback limit 100k, coordinator max 500k).

Check order is part of the ABI contract: existence first, then the errors in the order of the "Requires" column.

### 2.2 Coordinator facts relied upon (verified in arc-randomness)

- A reverting / out-of-gas callback is swallowed (`callbackSuccess = false`) and the request is still marked
  `Fulfilled`. Hence `claimGenes` (R2).
- `fulfill` accepts `Pending` **or** `Refunded` requests; with bounty 0 a refund is a no-op; the drand signature
  for the pinned round is public forever. Hence eggs never expire (R8).
- `requestRandomness(callbackGasLimit, bounty)` pins `currentRound() + 4` (~12 s). Bounty 0 needs no USDC approval.
- `getRequest(id).randomness` is the value passed to the callback, 0 until fulfilled. It is **not** the raw drand
  randomness: the coordinator derives one value per request,
  `keccak256(abi.encode(sha256(signature), block.chainid, coordinator, requestId))` (chainid 5042 on mainnet).
  So two eggs pinned to the same round get different genes, and an off-chain check of a pet's genes needs the
  drand signature of its round plus its `requestId` (both public).

## 3. Decay math (D4, D5, D6, R3, R4)

All integer, all in `PetLib`:

```
statAt(last, window, t) = 100                                  if t <= last
                        = 0                                    if t - last >= window
                        = 100 - floor(100 * (t - last) / window) otherwise        (range 1..100)
hunger(t)    = statAt(lastFed,    TH, t)
happiness(t) = statAt(lastPlayed, TP, t)
deathAt      = min(lastFed + TH, lastPlayed + TP)             (uint64)
isAlive(t)   = hatched && t < deathAt                          (false for eggs; buried pets are never alive)
age(t)       = 0                  if Egg
             = t - bornAt         if Alive
             = deathAt - bornAt   if Dead or Buried (frozen; equals diedAt - bornAt once buried)
```

Key property: `hunger(t) > 0 && happiness(t) > 0  <=>  t < deathAt`. There is no grace window (D6): a `feed` mined at
`t == deathAt` reverts `PetDead`.

`petInfo` for an Egg: `hunger = happiness = 100`, `deathAt = age = 0`, windows 0, decoded genes 0.

## 4. Genes (D10)

`genes` = the per-request ArcDraw randomness bytes32 (§2.2: `keccak256(abi.encode(sha256(sig), 5042, coordinator,
requestId))`), stored as is. `g = uint256(genes)`:

| Bits | Width | Field | Decode | Range |
|---|---|---|---|---|
| 0-1 | 2 | species | `g & 0x3` | 0..3 (`Blob`, `Cat`, `Bird`, `Bunny`) |
| 2-4 | 3 | palette | `(g >> 2) & 0x7` | 0..7 |
| 5-6 | 2 | eyes | `(g >> 5) & 0x3` | 0..3 |
| 7 | 1 | reserved | - | - |
| 8-15 | 8 | hunger gene `hg` | `(g >> 8) & 0xff` | 0..255 |
| 16-23 | 8 | play gene `pg` | `(g >> 16) & 0xff` | 0..255 |
| 24-255 | 232 | reserved for v2 | not read by v1 | - |

```
multiplierBps(x) = 8000 + floor(x * 4000 / 255)            8000..12000  (x = 0 -> -20%, x = 255 -> +20%)
TH = floor(86400  * multiplierBps(hg) / 10000)             69_120 .. 103_680 s
TP = floor(172800 * multiplierBps(pg) / 10000)             138_240 .. 207_360 s
```

Visual combinations: 4 x 8 x 4 = 128. Species names are a display convention shared by renderer and web; the palette
colour table and eye shapes are owned by `PetRenderer` (the web app shows the onchain SVG, it does not redraw it).

## 5. Names (R7)

- 1..20 bytes; every byte in `0x20..0x7E` except `"` (0x22), `&` (0x26), `<` (0x3C), `>` (0x3E), `\` (0x5C).
- Enforced in `hatch` via `PetLib.isValidName`; the SDK mirrors it (`isValidName`) for form validation.
- Consequence: the renderer embeds names in JSON and SVG without escaping. Non-ASCII (e.g. accents) is rejected in
  v1 (reversible later with an escaping renderer).
- Names are not unique and are immutable.

## 6. Mood (D11)

```
Egg                         -> Egg
Dead or Buried              -> Tomb
Alive and hunger < 30       -> Hungry   (priority over Sad)
Alive and happiness < 30    -> Sad
otherwise                   -> Happy
```

## 7. Metadata (`tokenURI`)

`tokenURI(id) = PetRenderer.render(id, petInfo(id), block.timestamp)`:

- `data:application/json;base64,` + base64 of
  `{"name":"<name> #<id>","description":"...","image":"data:image/svg+xml;base64,...","attributes":[...]}`.
- Attributes: `Species`, `Palette`, `Eyes`, `Status` (Egg/Alive/Dead/Buried), `Mood`, `Age (days)` (floor of
  `age / 86400`), and for Dead/Buried `Died` (unix `deathAt`, `display_type: "date"`).
- SVG: procedural bitmask sprite (8x8 or 12x12 per species, D11), palette fill, eye variant, mood overlay
  (hungry / sad / tomb). Target < 8 KB SVG; measure in tests.
- `PetRenderer` is an `internal` library (inlined into ArcPet). If ArcPet exceeds 24,576 bytes of runtime code,
  switch its entry points to `public` (linked library) and record it here.

## 8. Front end (D12, D13, R5)

- Ranking and graveyard: `totalSupply()` then multicall `petInfo(1..N)`; no logs, no indexer (logs are capped at
  10k blocks per `eth_getLogs`).
- Ranking "oldest alive": `status == Alive`, sort by `age` desc. Graveyard: `status in {Dead, Buried}`, sort by `age`.
- Live bars: compute `statAt` client-side from `petInfo` raw fields with the SDK mirror; never keep separate state.
- Hatch: `hatch(name)` -> read `EggLaid` (requestId, round) -> fetch drand quicknet signature for `round` ->
  `coordinator.fulfill(requestId, signature)` (ArcDraw SDK). If the egg is still an Egg after a `Fulfilled` request,
  show "Complete hatch" -> `claimGenes(id)`.
- Reminder: `.ics` event at `deathAt - 6h`.
- Routes (static export, GitHub Pages under `/arcpet`): `/app/` (my pet), `/app/pet/?id=N` (public page; a query param
  because a static export has no dynamic segments), `/app/ranking/`, `/app/graveyard/`. `site/index.html` is the
  project page at the root.
- Contract address: `deployments/arc-mainnet.json` (`NEXT_PUBLIC_ARCPET_ADDRESS` overrides). Empty, zero or placeholder
  addresses mean "not deployed yet" and nothing is read.
- The browser fulfill uses ArcDraw SDK code vendored into `packages/sdk/src/vendor/arcdraw` (drand fetch + local BLS
  check); the fulfill gas limit is ArcDraw's worst-case bound so the 100k callback budget is always available.
- Clock: bars, countdowns and the egg's "round is out" check use the chain clock (latest block timestamp offset).

## 9. Invariants (test targets)

1. A pet that is Dead or Buried at `t` is Dead or Buried at every `t' >= t` (no revival): `deathAt` changes only via
   `feed`/`play` on an Alive pet, and only upwards.
2. For every wallet, at most one pet is Egg or Alive.
3. `genes` is written at most once per pet (callback or `claimGenes`, never both, never overwritten).
4. `diedAt` is written at most once and equals `deathAt` at that time; `diedAt >= bornAt`.
5. `ownerOf(id)` never changes after mint; `balanceOf(owner)` counts every pet ever minted to it.
6. `totalSupply()` == number of mints; ids are `1..totalSupply()`.
7. The contract never holds or moves USDC and has no `payable` function.
8. The ArcDraw callback never reverts for any `(requestId, randomness)`.

## 10. Test plan (from the plan's task 1/2)

- Unit: every row of §2.1 including every revert; soulbound entry points; ERC-165 ids.
- Fuzz: `statAt`/`deathAt` properties (§3), gene decode ranges (§4), name validation (§5), SDK parity via vectors.
- Invariant: §9 with a handler (hatch/feed/play/bury/warp/fulfill with a mock coordinator).
- Callback failure: mock coordinator that calls with too little gas -> request Fulfilled, pet Egg -> `claimGenes`.
- Fork (skipped unless `ARC_FORK_TESTS=true`): real coordinator at `0x3cfD...0324`, request + fulfill with a quicknet
  fixture (reuse arc-randomness fixtures) + `claimGenes`.
- Gas snapshot: `feed`, `play`, `hatch`, callback, `bury`, `tokenURI`.
