# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries
come from the Conventional Commit history (`COMMIT.md`).

## [Unreleased]

## [0.3.0] - 2026-11-14

### Added

- Every page keeps its setup across a route change: the collection URL, the wallets, the
  filter, the sort, the selection, the destination, the swap draft and its resolved quotes,
  the offer book and currency, the eligibility result, and every mint task with its active
  row. A scan or run still in flight keeps reporting after the round trip, and a reload
  still starts fresh ([#115]).
- The Bulk Sell rail has a second tab, `Cancel listings`. It reads the active orders of the
  selected wallets on the collection, withdraws the ones left checked in one click, signs
  each cancel with its own offerer wallet, and reports the window in which a buyer can still
  fill a withdrawn order ([#113]).
- The order hash on a listed row is copyable and opens the token's page on OpenSea. It is an
  order hash, not a transaction hash, so no explorer link is built from it ([#113]).
- A Velox menu on right-click, with Copy and Paste. Copy takes the field's selection, then
  the page's, then the whole value; Paste inserts through the field's own insertion command,
  so React's state stays in step. Paste reads the clipboard through the in-app command,
  because the webview answers every `navigator.clipboard.readText` with a native permission
  dialog ([#104]).

### Changed

- The four held-NFT pages share one header: one shape, one count rule, named filter inputs,
  and a live region that announces the scan rather than the run ([#103]).
- `RULES.md` states the panel-header layout once, and its example now matches it ([#102]).

### Fixed

- A mint run claims the shared run slot. Another batch flow refuses to start while it signs,
  and an abort now reaches the wallet loop instead of being ignored ([#115]).
- Instant sell keeps wildcard collection offers instead of dropping them, keeps the offer
  rail inside the viewport, refreshes each offer's age on the minute, and no longer prints
  the earliest-expiry line twice ([#98]).
- The inventory body scrolls on the table pages and on the portfolio page: the page shell
  is pinned to the viewport instead of growing with its content ([#106], [#107]).

## [0.2.0] - 2026-11-13

### Added

- The installed app runs under an explicit content-security policy. It names the OpenSea,
  Relay, chain-RPC, Alchemy, Ankr and Blockscout endpoints the window calls, the Iconify
  and OpenSea image hosts, and nothing else, so the CoinMarketCap host stays out because
  the quote happens in Rust ([#77]).
- The three in-app commands sit under an application ACL manifest, and one capability
  grants the core defaults, the updater and those commands to the main window alone. A
  command no capability grants is rejected at runtime ([#77]).
- Pushing a `vX.Y.Z` tag runs a release workflow that builds the signed installer, checks
  `latest.json` against it, and opens a draft release for a person to publish. The job
  fails instead of shipping an unsigned installer when its signing secrets are missing.
- The PnL card prices its USD figure in the installed app. The operator's CoinMarketCap
  key reaches an in-app command that keeps the route's statuses, caches a quote per key
  for a minute, and bypasses the cache for a probe. With no key the card asks for one and
  links to Settings instead of reporting a request error ([#75]).
- Settings exports wallets, folders, provider connections and PnL records as one versioned
  JSON file and imports it back, so a fresh install starts with the operator's data. The
  import previews the counts it found, refuses a document from a newer version or a damaged
  one, and writes nothing until it is confirmed. Settings also states that uninstalling with
  "delete app data" ticked deletes the wallets ([#76]).
- The installed app signs in to OpenSea with no dev server behind it. The sign-in nonce and
  the token exchange run as in-app commands that keep the relay route's statuses, messages,
  cookie handling and single entitlement retry, and the web lane keeps signing in through
  its mocked route ([#74]).
- A signed Windows installer and an in-app update. `npm run release:desktop` builds the
  NSIS installer with its updater signature and writes `latest.json`; an installed copy
  offers the newer version on launch and installs it in place, keeping wallets, folders
  and PnL records (#78).
- Authenticode signing when `VELOX_WIN_CERT_THUMBPRINT` is set. With no certificate the
  build still produces a working installer, and the SmartScreen warning on first run is
  expected.
- `npm run release:verify` re-checks the artifacts and `npm run test:release` covers the
  manifest logic.

### Fixed

- The sidebar reports the package version instead of a hardcoded `v1.0.0`.

## [0.1.2] - 2026-11-11

### Added

- An E2E suite. `tests/` holds a mocked lane that covers the pages with a headless browser
  (`npm run test:e2e`) and a live lane against real wallets, drops and providers
  (`npm run test:e2e:live`, `npm run test:e2e:mint`), configured by `e2e.config.ts` and
  `e2e.live.config.ts` ([#34], [#35], [#42]).

### Changed

- The library moved to one folder per domain in `src/lib/` and `src/hooks/` (#46 to #69). No behaviour changes.
- A transaction hash renders as an underlined `Tx Hash` link on mint tasks, transfer, instant
  sell and swap, so the explorer is one click away instead of a masked string.

## [0.1.1] - 2026-11-09

### Changed

- Mint broadcasts run two wallets at a time and receipt waits four at a time, so a
  batch no longer serializes every wallet's network round trip.
- The live mint guard passes OpenSea's pre-open 409 through to the app; only the
  open-time 200 is validated.

### Fixed

- The armed mint fires at the stage open even when the pre-open prepare request is
  rejected, and the prepare no longer races the open fire.
- Arm waits sleep in bounded steps, so a stage more than 24 days out no longer
  overflows the timer.
- Eligibility matches stage UUIDs across dashed and undashed formats.

## [0.1.0] - 2026-11-08

First release. Everything below was built before the repository had tags, so it is
consolidated into a single entry.

### Added

- Mint workspace (`/mint/tasks`): a task queue per wallet, a stage picker, a quantity
  ceiling read from OpenSea, and Start Mint that arms a task and fires when the stage
  opens, timed against chain block time.
- Eligibility page (`/mint/eligibility`): SIWE sign-in per wallet, per-stage eligibility,
  price and cap, and saved snapshots.
- PnL card (`/pnl/card`): collection card with a live ETH/USDT quote, portrait and
  landscape layouts, uploaded images, and PNG export.
- Monthly PnL (`/pnl/monthly`): records stored in IndexedDB, with delete and in-place
  replacement of a re-check.
- Lifetime PnL (`/pnl/lifetime`): aggregate position with a persisted PnL split.
- Portfolio (`/portfolio`): holdings scan through OpenSea with OpenRarity ranks.
- Bulk Sell (`/bulk-sell`): Seaport listing plan across wallets at one price, run two
  wallets at a time.
- Instant Sell (`/instant-sell`): collection offers, a per-wallet offer ladder, and
  fulfillment encoding.
- Transfer (`/transfer`): ERC-721 and ERC-1155 transfers from many wallets to one
  destination, with grouped selection.
- Swap (`/swap`): Relay quotes, approvals, WETH wrap and unwrap, and per-wallet amounts.
- Settings (`/settings`): provider connection registry for OpenSea and CoinMarketCap
  credentials and per-chain RPC endpoints, with probes.
- Wallet Profiles (`/wallet-profiles`): folder groups, wallet import, and the active
  chain.
- Local API: OpenSea SIWE sign-in (`/api/auth/nonce`, `/api/auth/token`) and a
  CoinMarketCap price route cached for 60 seconds and keyed per credential.
- Theme provider, sidebar layout, and the shared UI primitives the pages build on.

### Changed

- Router and sidebar derive from one route table ([#24]).
- Migrations run from a version-keyed table ([#23]).
- One store hook is shared across snapshots, wallets and PnL ([#22]).
- The balance cache key is built in one place ([#21]).
- Fixed retry and pacing sleeps got names ([#20]).
- Shared table furniture is extracted from the batch pages ([#25]).
- Every async read goes through one epoch hook and one preamble ([#26]).
- Every error message routes through one redacting converter ([#29]).

### Fixed

- Instant sell ticks the sale plan's clock with the offer ladder ([#28]).
- A missing USD figure is reported only when none is shown ([#28]).
- A finished swap run shows its received total in its own token ([#27]).
- A finished run keeps its progress fields ([#27]).
- The eligibility check marks itself running before the target read ([#26]).
- The run status error line is gated on presence ([#25]).
- `use-store` keeps its reader stable across renders ([#22]).
- Target read failures route through the error converter ([#29]).

[Unreleased]: https://github.com/K4nes/Velox/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/K4nes/Velox/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/K4nes/Velox/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/K4nes/velox/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/K4nes/velox/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/K4nes/velox/releases/tag/v0.1.0
[#20]: https://github.com/K4nes/velox/pull/20
[#21]: https://github.com/K4nes/velox/pull/21
[#22]: https://github.com/K4nes/velox/pull/22
[#23]: https://github.com/K4nes/velox/pull/23
[#24]: https://github.com/K4nes/velox/pull/24
[#25]: https://github.com/K4nes/velox/pull/25
[#26]: https://github.com/K4nes/velox/pull/26
[#27]: https://github.com/K4nes/velox/pull/27
[#28]: https://github.com/K4nes/velox/pull/28
[#29]: https://github.com/K4nes/velox/pull/29
[#34]: https://github.com/K4nes/velox/pull/34
[#35]: https://github.com/K4nes/velox/pull/35
[#42]: https://github.com/K4nes/velox/pull/42
[#74]: https://github.com/K4nes/Velox/issues/74
[#75]: https://github.com/K4nes/Velox/issues/75
[#76]: https://github.com/K4nes/Velox/issues/76
[#77]: https://github.com/K4nes/Velox/issues/77
[#98]: https://github.com/K4nes/Velox/pull/98
[#102]: https://github.com/K4nes/Velox/pull/102
[#103]: https://github.com/K4nes/Velox/pull/103
[#104]: https://github.com/K4nes/Velox/pull/104
[#106]: https://github.com/K4nes/Velox/pull/106
[#107]: https://github.com/K4nes/Velox/pull/107
[#113]: https://github.com/K4nes/Velox/pull/113
[#115]: https://github.com/K4nes/Velox/issues/115
