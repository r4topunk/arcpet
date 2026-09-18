# CHECKLIST: human-only steps, in order

Agents cannot do these: they need keys, USDC, accounts or publishing. Commands are in [README.md](README.md#deploy-owner-only).
DoD for the whole list: ArcPet verified on Sourcify, the D17 demo tx hashes in the README and
`deployments/arc-mainnet.json`, a live site, and the ArcPet BUIDL submitted on DoraHacks.

| # | Step | Needs | Done when |
|---|---|---|---|
| 1 | `pnpm install && pnpm check && pnpm --filter @arcpet/web build` on a clean clone | Machine | Exit 0 |
| 2 | Pick the deployer keystore (`cast wallet list`) and fund it with ~0.5 USDC on Arc mainnet | Keystore, USDC | `cast balance [DEPLOYER] --rpc-url arc` > 0 |
| 3 | Simulate `script/Deploy.s.sol` (no `--broadcast`) | Keystore password | Prints chainId 5042, the coordinator `0x3cfD…0324` and a predicted ArcPet address |
| 4 | Deploy with `--broadcast --verify --verifier sourcify` **[SPENDS]** | Keystore password | ArcPet address printed; tx on explorer.arc.io |
| 5 | `node script/record-deployment.mjs` (from `contracts/`) | Broadcast log | `contracts.ArcPet.address/deployBlock/deployTx` filled in `deployments/arc-mainnet.json` |
| 6 | Confirm Sourcify match (retry with `forge verify-contract` if needed), set `"verified": true` | Browser | sourcify.dev shows a full/exact match for chain 5042 |
| 7 | Fund three demo wallets main / B / C with ~0.1 USDC each | USDC | Balances visible |
| 8 | Demo: hatch the main pet, pet B and pet C with names, from the web app | 3 wallets | 3 `hatch` txs; each egg hatched (browser fulfill, or `claimGenes` if the callback failed) |
| 9 | Demo: B feeds C's pet (social care) | Wallet B | `feed` tx from B on C's pet id |
| 10 | Demo: keep the main pet alive; leave C's pet alone until it dies (up to ~24h + genes, see `deathAt` on its page) | Wait **>= 24h** | C's pet page shows Dead |
| 11 | Demo: B buries C's pet (permissionless bury) | Wallet B | `bury` tx from B; pet shows Buried in the graveyard |
| 12 | Fill every tx hash in `deployments/arc-mainnet.json` (`demo.*`) and the README tables; replace every `TBD` | Explorer | `grep -n TBD README.md` is empty |
| 13 | Create the GitHub repo `r4topunk/arcpet`, push, enable Pages (source: GitHub Actions); optionally set repo variable `NEXT_PUBLIC_ARCPET_ADDRESS` | GitHub account | `https://r4topunk.github.io/arcpet/` and `/arcpet/app/` load and show the live pets |
| 14 | Submit the ArcPet BUIDL on DoraHacks (see [SUBMISSION.md](SUBMISSION.md)). This can be done before the bury tx (step 11): the proof table links the README demo table as the live source of hashes. The form keeps no draft; dropdown selections linger, so re-check them | DoraHacks account | BUIDL visible on the Arc Microgrants page before 2026-10-14 23:59 ET |
| 15 | Follow-up after step 11: paste the bury tx hash into the BUIDL (proof #6), if DoraHacks allows editing a submitted BUIDL | DoraHacks account | BUIDL shows the bury hash, or the README demo table has it if editing is not allowed |
| 16 | Mention ArcPet as a consumer in the ArcDraw README (optional) | GitHub account | ArcDraw README links the ArcPet repo and contract |
