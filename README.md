<div align="center">
  <img src="public/velox-logo.png" width="120" alt="Velox logo" />
  <h1>Velox</h1>
  <p>One console for NFT operations across many EVM wallets.</p>
</div>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%3E%3D22.12-339933" alt="Node" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/react-19-61dafb" alt="React 19" /></a>
  <a href="#contributing"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
</p>

Velox is a local web console for running NFT operations across a set of EVM wallets
without switching between tabs. Mint tasks, eligibility checks, PnL tracking, portfolio
scans, bulk listings, offer sales, transfers and swaps all read the same wallet list and
the same provider settings.

It runs on your machine. Wallet keys are stored in the browser and signing happens
locally, so there is no account, no upload and no remote backend — just a Vite app with
three small server-side routes for the calls a browser cannot make alone.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Getting started](#getting-started)
- [What you can do](#what-you-can-do)
- [Configuration](#configuration)
- [Development](#development)
- [Data and security](#data-and-security)
- [Contributing](#contributing)
- [Changelog](#changelog)
- [Maintainers](#maintainers)
- [License](#license)

## Requirements

- Node `^20.19` or `>=22.12` (the engine range Vite 8 declares) and npm.
- Network access to OpenSea, Relay, CoinMarketCap and the RPC endpoints you configure.
- A browser with IndexedDB. Chromium or Firefox is fine.

## Installation

```bash
git clone https://github.com/K4nes/velox.git
cd velox
npm install
```

There is no published package and no installer. The app is the repository.

Optionally, create `.env.local` to give the dev server a fallback price key:

```bash
CMC_API_KEY=your_coinmarketcap_key
```

`.env.local` is git-ignored. Stored keys are tried first; the environment key answers
when none is stored or every stored key is rejected.

## Getting started

```bash
npm run dev
```

Open the printed URL (default `http://localhost:5173`). Two steps before the pages do
anything useful:

1. **Settings** — add an OpenSea API key. Most pages read OpenSea with it. Add a
   CoinMarketCap key and RPC endpoints to run the price and on-chain reads on your own
   accounts.
2. **Wallet Profiles** — import wallets, then pick the active chain.

A fresh install opens on `/mint/tasks` with an empty wallet list.

## What you can do

| Page | Route | What it does |
| --- | --- | --- |
| Mint Tasks | `/mint/tasks` | Schedules mints for a drop. Start Mint arms a task and fires when the stage opens, timed against chain block time. |
| Mint Eligibility | `/mint/eligibility` | Signs each wallet in with SIWE and reads its per-stage eligibility, price and cap for a drop. Saves the result as a snapshot. |
| PnL Card | `/pnl/card` | Builds a shareable PNG card for a collection, priced with a live ETH/USDT quote. |
| Monthly PnL | `/pnl/monthly` | Per-day PnL records for a collection: spent, realized, basis, current value. |
| Lifetime PnL | `/pnl/lifetime` | Aggregates every stored record into one position. |
| Portfolio | `/portfolio` | Scans wallet holdings through OpenSea and adds OpenRarity ranks. |
| Bulk Sell | `/bulk-sell` | Lists NFTs held across wallets at one price, through OpenSea listings. |
| Instant Sell | `/instant-sell` | Takes OpenSea collection offers against held NFTs. |
| Transfer | `/transfer` | Moves ERC-721 and ERC-1155 tokens from many wallets to one destination. |
| Swap | `/swap` | Routes a swap through Relay, including WETH wrap and unwrap. |
| Wallet Profiles | `/wallet-profiles` | Imports and groups wallets into folders, and picks the active chain. |
| Settings | `/settings` | Provider connections: OpenSea and CoinMarketCap credentials, RPC endpoints per chain. Exports and imports the wallets, folders, connections and PnL records as one JSON file. |

Chains: Ethereum, Base, Robinhood Chain, ApeChain (`src/config/chains.ts`).

## Configuration

Everything a user configures lives in **Settings**, not in the environment:

| Item | Where | Notes |
| --- | --- | --- |
| OpenSea API key | Settings → Connections | Required by every page that reads OpenSea. Multiple keys rotate. |
| CoinMarketCap key | Settings → Connections | Used for the ETH/USDT quote. Optional. |
| RPC endpoints | Settings → Connections | Alchemy, Ankr or a custom URL, per chain. |
| `CMC_API_KEY` | `.env.local` | Server-side fallback for the quote only. |

## Development

```bash
npm run dev             # dev server with the local API routes
npm run build           # tsc -b, then vite build
npm run lint            # oxlint
npm run preview         # serve dist/ with the same local API routes
npm run test:e2e        # headless browser suite, mocked lane
npm run test:e2e:live   # live lane on real wallets, drops and providers
npm run test:e2e:mint   # live lane, mint only
```

`test:e2e` starts its own Vite server on a free port and needs no setup. The two live
scripts read the `E2E_*` values from the git-ignored `.env.e2e.local`. Without them the live
specs skip. Changes are checked with `npm run build` and the suite that covers the page you
touched.

### How it fits together

- **Frontend.** React 19, TypeScript, Vite 8, Tailwind 4. The route table is
  `src/config/routes.tsx`; `src/router.tsx` builds the router from it
  (`createBrowserRouter`); page files mirror the URL; everything renders inside `AppLayout`.
- **Domain logic.** `src/lib/` holds the OpenSea, Seaport, Relay, PnL, transfer and wallet
  code. `src/hooks/` drives the long-running flows (scans, listings, mints, swaps) and
  their run state.
- **Local API.** `server/` is a Vite plugin that mounts three routes on the dev and
  preview servers:
  - `/api/auth/nonce` — the OpenSea SIWE message for an address.
  - `/api/auth/token` — verifies the signed message, mints an OpenSea token scoped
    `read:eligibility` with a one-day life, exchanges it for a short-lived access token,
    then revokes the minted token. The long-lived credential never reaches the browser.
  - `/api/price/eth-usdt` — CoinMarketCap quote, cached for 60 seconds and keyed per
    credential.

  Each exists because it needs something the browser cannot hold: a server-side credential
  or an upstream cookie. Every other request goes from the browser straight to OpenSea,
  Relay or an RPC endpoint.
- **Components.** `src/components/ui/` is the vendored shadcn and Animate UI library;
  `src/components/layout/` is page chrome; page-specific components live next to their
  page under `src/pages/<feature>/`.

`dist/` on its own is a static bundle with no `/api` routes. Sign-in works in the installed
app, because it runs through the app's own commands; the price quote still needs the route,
so it only works under `npm run dev` or `npm run preview` until #75.

## Data and security

Nothing leaves the browser except the requests a page makes and the backup the operator
chooses to download. That file holds wallet private keys and provider API keys in plain
text, so the Settings card asks the operator to keep it private.

| Store | Contents |
| --- | --- |
| IndexedDB `velox` | wallets (folder, label, address, private key), folders, eligibility snapshots, PnL records, provider connections |
| `localStorage` | theme, active chain, cached card images |

IndexedDB version and migrations live in `src/lib/db/`. PnL records carry a version
field (`v`) on their nested `breakdown`; readers test that it is present, to tell the
current split from the legacy `invested` shape.

Two things to know before you put real assets in it:

- **Private keys are stored unencrypted** in IndexedDB. Anyone with access to this browser
  profile can read them. Use a dedicated profile, and wallets you are willing to expose.
- The dev server has no authentication. It binds to localhost; do not expose it with
  `--host` or a tunnel.

OpenSea keys go from the browser straight to OpenSea. The CoinMarketCap key goes to the
local `/api/price/eth-usdt` route, which forwards it upstream. Both sit in the same
browser database as the wallets.

## Contributing

Issues and pull requests are welcome. Before opening one:

- Read `RULES.md` — component, routing, layout and UI conventions. It is binding, and it
  lists the deliberate exceptions that should not be normalised.
- Follow `COMMIT.md` for commit messages (Conventional Commits, English, imperative).
- Keep a change checkable: `npm run build` must pass, and the affected page must run.
- Do not claim verification you did not run. Reviews follow `REVIEW.md`.

For changes to a page layout, include a screenshot in the pull request. The pages target
1024px and wider; below that only the chrome collapses.

## Changelog

Release notes live in [CHANGELOG.md](CHANGELOG.md). The version is declared in
`package.json`, and each release is tagged `vX.Y.Z` on `main`.

## Maintainers

[@K4nes](https://github.com/K4nes).

## License

[MIT](LICENSE) © 2026 K4nes

Third-party work keeps its own license: the packages in `package-lock.json`, and the
Inter and Geist fonts, which ship under the SIL Open Font License 1.1
(`OFL-1.1`) — Inter vendored under `public/fonts/`, Geist through
`@fontsource-variable/geist`.
