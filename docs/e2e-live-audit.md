# E2E live-readiness audit

Status: static audit. The audit was read-only. This Markdown file is the only new artifact. No source files changed. No E2E suite ran.

## Result

The starting premise needs one correction: the current live lane does **not** run most E2E specs. There are 21 spec files: 15 mocked specs and 6 live specs.

- `e2e.config.ts:6` runs `tests/**/*.e2e.ts` and excludes `tests/**/live/**`.
- `e2e.live.config.ts:6` matches only `tests/**/live/**/*.e2e.ts`.
- `package.json:14-15` splits the six live specs into four non-mint paths and the two real mint specs.
- `.github/workflows/verify.yml:76-79` runs the mocked lane with no `E2E_*` values.

The concern is still valid. All six live specs carry at least one live-data assumption that can fail or silently prove the wrong thing. Also, 11 of the 15 mocked specs would fail if repurposed against real providers. They depend on fake slugs, fake keys, fake RPC endpoints, fixed prices and exact row counts.

## Rule checked

`RULES.md:305-310` requires live tests to take external identity and connection values from environment variables or explicit test options. The list includes collection URL/slug, wallet key/address/label, expected status, chain, RPC and API endpoints. It also requires a clear skip when required env is absent. `RULES.md:311-315` requires reusable mock helpers to accept collection, slug, stage, address and response values as options. `RULES.md:316-317` requires local values in the ignored `.env.e2e.local` and documented variable names.

> 🧠 **From Hindsight memory (Conventions and patterns)** — #44 documented the E2E live-data/mock rule and #45 removed RH8 fixtures; the current rule was checked against `RULES.md:303-317`.

> 🧠 **From Hindsight memory (Key decisions and rationale)** — mint arming was moved to chain time; this was checked against `src/lib/chain/tx.ts:81-84` and `src/hooks/run/use-mint-tasks.ts:927-935`.

## Live-lane findings

| Severity | Finding | Failure scenario and impact |
| --- | --- | --- |
| High | The live config selects all six live specs. `e2e.live.config.ts:6` includes `tests/mint/live`; `package.json:14-15` only splits them with script arguments. | A caller that uses the config without those path arguments can start real mints. The impact is unintended on-chain spend. Positional-filter semantics remain unverified because `node_modules` is absent. |
| High | Both mint specs pin max fee to `1` gwei and priority fee to `0.1` gwei in `tests/support/mint.ts:500-503`. They call it at `tests/mint/live/open.e2e.ts:62` and `tests/mint/live/scheduled.e2e.ts:78`. The app signs those values at `src/hooks/run/use-mint-tasks.ts:506-507` and broadcasts at `src/lib/chain/tx.ts:178-230`. | When the live base fee exceeds 1 gwei, the transaction cannot confirm. The test waits for `Confirmed` and fails after a real broadcast attempt. |
| High | `E2E_OPENSEA_API_URL` controls only the test preflight. See `tests/pnl/live/card.e2e.ts:21,74-76` and `tests/portfolio/live/scan.e2e.ts:13,26-28`. The seeded connection holds only a key at `tests/support/data.ts:73-81`. The app hardcodes `https://api.opensea.io/api/v2` at `src/lib/chain/http.ts:1` and uses it at `src/lib/opensea/index.ts:183`. | A proxy or staging URL can pass the preflight while the UI reads production. Chain and name checks then describe the wrong dataset. The test cannot point the app at a different provider. |
| High | Scheduled mint uses wall time, but the app fires on chain time. `tests/support/mint.ts:72-80` reads `Date.now()`. `tests/mint/live/scheduled.e2e.ts:49-61,90` uses that clock for bounds and timeout. The app samples chain time at `src/lib/chain/tx.ts:81-84` and fires at `src/hooks/run/use-mint-tasks.ts:927-935,961-965`. | A clock offset or slow RPC sample rejects a valid drop or makes `Confirmed` arrive after the timeout. The two-minute floor at `tests/mint/live/scheduled.e2e.ts:54-57` is also shorter than the 120-second row wait at `tests/support/mint.ts:146-151`. |
| Medium | Both mint specs omit `E2E_MINT_TO_CONTRACT` from their `ready` gates: `tests/mint/live/open.e2e.ts:14-20` and `tests/mint/live/scheduled.e2e.ts:14-20`. The body requires it at `:51` and `:67`. | A missing value throws after a real wallet and drop preflight. `RULES.md:305-310` requires a clear skip instead. |
| Medium | Paid drops fail by default. `tests/support/mint.ts:401-451` caps mint value at `E2E_MAX_MINT_VALUE_WEI ?? 0`. Both specs read the real stage price at `open.e2e.ts:56` and `scheduled.e2e.ts:72`. | Any positive mint value fails the guard unless another undocumented env value is set. The guard protects funds, but a paid drop cannot pass as a suite test. |
| Medium | PnL treats a partial live read as a bug. `tests/pnl/live/card.e2e.ts:183,220-223` requires no `partial read`, `truncated: false` and `unpriced: false`. The app sets those flags for page caps, ambiguous trades and non-ETH payment legs at `src/lib/pnl/pnl-trades.ts:308,356,376`. It labels such rows at `src/pages/pnl/monthly.tsx:307`. | A high-volume wallet can fail the test while the app behaves correctly. The suite cannot separate a defect from a valid partial read. |
| Medium | Portfolio requires holdings and perfect rarity data. `tests/portfolio/live/scan.e2e.ts:82-83` requires at least one owned NFT and zero `could not be ranked` text. The app raises that toast for missing or failed rarity rows at `src/hooks/scan/use-portfolio-scan.ts:109-119`. | A valid wallet may hold none. One failed provider batch fails the test. Both outcomes are external-data conditions, not UI defects. |
| Medium | Live identity, chain, host and drop type remain hardcoded. See `tests/support/mint.ts:60-67,419-440`, `tests/eligibility/live/eligibility.e2e.ts:20-24,43-50,54,65`, `tests/wallet-profiles/live/balance.e2e.ts:29,43` and `tests/support/data.ts:63`. | A non-Robinhood drop fails `readDrop`. The eligibility test can pass with `Ineligible` for a wrong-chain collection, which proves nothing about eligibility. This breaks `RULES.md:305-308`. |
| Medium | The balance test rejects `0.0000 ETH` at `tests/wallet-profiles/live/balance.e2e.ts:49-51`. `src/lib/wallet/wallet-model.ts:25-26` rounds to four decimals. | A wallet with less than `0.00005 ETH` displays `0.0000 ETH` and fails. The skip message does not say that the wallet must hold a visible balance. |

## Mocked lane

11 of the 15 mocked specs are bound to deterministic fixtures:

- Fake slugs: `tests/bulk-sell/bulk-sell.e2e.ts:19`, `tests/eligibility/eligibility.e2e.ts:14`, `tests/portfolio/portfolio.e2e.ts:17`.
- Fake RPC endpoints: `tests/swap/swap.e2e.ts:7`, `tests/transfer/transfer.e2e.ts:24`, `tests/support/mint.ts:51`.
- Fake keys, prices and timestamps: `tests/bulk-sell/bulk-sell.e2e.ts:67`, `tests/pnl/pnl.e2e.ts:39,49`, `tests/eligibility/eligibility.e2e.ts:39`.
- Exact row counts: `tests/bulk-sell/bulk-sell.e2e.ts:81,253,438`, `tests/portfolio/portfolio.e2e.ts:186`, `tests/mint/mint-state.e2e.ts:198`.
- `tests/support/opensea.ts:42-45` aborts any unanticipated OpenSea request.

Real providers would return 404, DNS, 401 or different row counts. Four specs are mostly lane-agnostic: `tests/shell/shell.e2e.ts:18`, `tests/mint/mint-guard.e2e.ts:13`, `tests/settings/settings.e2e.ts:4` and `tests/shell/context-menu.e2e.ts:14`.

The last one still depends on granted clipboard permissions. It calls the clipboard API at `tests/shell/context-menu.e2e.ts:90-92,151-153`. The mocked config grants permissions at `e2e.config.ts:19-21`; the live config does not (`e2e.live.config.ts:17-24`).

## Standards and setup gaps

- `tests/support/mint.ts:162-191,309-372` embeds one stage, contract, auth token and response set. Its route patterns use `[^/]+`, so the `slug` option does not scope the routes. This conflicts with `RULES.md:311-315`.
- `RULES.md:316-317` says to document variable names. `README.md:135-137` names only the env file. No committed `.env.e2e.example` or Markdown variable list was found. Required names such as `E2E_MINT_TO_CONTRACT` and `E2E_MAX_MINT_VALUE_WEI` live only in code and skip messages.
- `tests/support/env.ts:1-4` loads `.env.e2e.local` at import. `tests/support/env.ts:6-14` throws when a required value is absent. A complete skip gate must list every value the body later requires.

## Checked and rejected

- The pre-seed public-RPC tripwire at `tests/wallet-profiles/live/balance.e2e.ts:35-45` is not a race. The first page has no wallet rows, so `src/hooks/data/use-wallet-balances.ts:126-128` returns before any fetch.
- A scout report counted 17 mocked specs. File enumeration found 15. Another scout report used shifted line numbers. All references in this report were checked against the files.
- The `e2e` CLI positional-filter behaviour was not verified from source. `node_modules` is absent in this workspace. The npm script intent is clear; the config glob itself is explicit.

## Verification

Static audit only. No build, typecheck, lint or E2E suite ran. The audit used file reads, targeted content searches and source cross-checks. `git status --short` was empty before this file was written. This Markdown file is the only new artifact.
