# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries
come from the Conventional Commit history (`COMMIT.md`).

## [Unreleased]

### Added

- Settings exports wallets, folders, provider connections and PnL records as one versioned
  JSON file and imports it back, so a fresh install starts with the operator's data. The
  import previews the counts it found, refuses a document from a newer version or a damaged
  one, and writes nothing until it is confirmed. Settings also states that uninstalling with
  "delete app data" ticked deletes the wallets ([#76]).

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

[Unreleased]: https://github.com/K4nes/velox/compare/v0.1.2...HEAD
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
[#76]: https://github.com/K4nes/Velox/issues/76
