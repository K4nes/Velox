# AGENTS.md

Instructions for coding agents working in this repository. `RULES.md` is the binding
source for component, routing, layout and UI conventions; this file covers what you need
before touching code and points to it where it is the authority.

## Project

Velox is a single-page operator console for NFT work across stored EVM wallets: mint,
PnL, portfolio, bulk sell, instant sell, transfer, swap. React 19 + TypeScript + Vite 8,
Tailwind 4, shadcn/Animate UI components vendored into `src/components/ui/`.

There is no backend service. `server/` is a Vite plugin that mounts `/api/auth/*`
(OpenSea SIWE) and `/api/price/eth-usdt` (CoinMarketCap) on the dev and preview servers,
and nothing else. All wallet signing happens in the browser with keys from IndexedDB.

## Commands

| Command | Use |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Dev server; the only mode with hot reload and the full app. |
| `npm run build` | `tsc -b` then `vite build`. The type-check gate. |
| `npm run lint` | oxlint. |
| `npm run preview` | Serves `dist/` with the same `/api` routes. |

No test runner exists. Do not add one unprompted, and do not claim tests ran.

## Verify

Cheapest check that settles the change, in order:

1. Read the diff.
2. `npx tsc -b --force`
3. `npm run build`
4. A browser run of the page — only when the task asks for it, or when the change cannot
   be settled any cheaper.

## Layout

| Path | Holds |
| --- | --- |
| `src/router.tsx` | The whole route table, with `handle.title` per route. |
| `src/pages/` | Route components; the path mirrors the URL. Feature components colocate in `src/pages/<feature>/`. |
| `src/components/ui/` | Vendored shadcn + Animate UI primitives. |
| `src/components/layout/` | `app-layout`, `app-header`, `app-sidebar`. |
| `src/components/` | Components shared by several pages (`wallet-select`, `empty-state`, `summary-row`, `token-image`). |
| `src/lib/` | Domain logic: OpenSea, Seaport, Relay, PnL, transfer, swap, wallets, storage. |
| `src/hooks/` | Long-running flows and their run state (scans, listings, mints, swaps). |
| `src/config/` | Chains, nav groups, swap assets. |
| `server/` | Vite middleware: SIWE proxy, CMC price route. |
| `docs/` | Local research notes; not tracked by git. |

## Rules that break things if ignored

**Routes.** Add the route to `src/router.tsx` with its `handle.title`, and create the page
file at the matching path. The title renders once, in `app-header`; never repeat it as an
`h1` in the page body.

**Navigation.** Sidebar entries come from `src/config/nav.ts`. Active state is derived from
`useLocation`, never hardcoded.

**Vendored components.** A look that belongs to one page is a `className` at the call site.
Edit a file in `src/components/ui/` only when the change must hold for every instance.
`npx shadcn add` and `npx @animate-ui/cli animate` overwrite files from the registry; diff
every reported overwrite and re-apply the local edits.

**`src/lib/chain/connection-model.ts` stays free of runtime imports.** It is written to be
type-stripped and loaded by plain Node without the `@/` alias. Adding a runtime import
breaks that.

**Storage.** IndexedDB schema changes need a `DB_VERSION` bump in `src/lib/db/db.ts` plus a
migration inside the `versionchange` transaction. PnL records carry a `v` field that
readers branch on; bump it when a stored field changes meaning. localStorage holds theme,
active chain and the card image cache only.

**Secrets.** Wallet private keys never leave the browser and are only used to sign
locally. Provider API keys come from the browser store; the CoinMarketCap key may travel
to `/api/price/eth-usdt` in a header, and nothing else should. Do not log either kind. A
new route under `server/` needs a reason the browser cannot handle on its own.

**Chains.** `src/config/chains.ts` is the chain list. A new chain needs an entry there, an
RPC connection, and swap asset refs when it participates in swap.

**Layout target.** Pages are designed for 1024px and wider. Below that only chrome
collapses. Read `RULES.md` before changing page shell, panel headers, tables or rails; the
deliberate exceptions listed there are requirements, not leftovers.

## Releases

The project follows SemVer. Versions live in `package.json` and `CHANGELOG.md`, and every
release is tagged `vMAJOR.MINOR.PATCH` — a `v` prefix, no suffixes, no dates.

- `0.y.z` while the app is still settling; `1.0.0` once a user can rely on the data
  format and the page behaviour without reading the diff.
- `MAJOR` — a change that breaks a user: an IndexedDB migration that drops data, a
  renamed or removed page, a stored record whose meaning changes.
- `MINOR` — a new page, a new provider, a new capability.
- `PATCH` — fixes and refactors with no user-visible behaviour change.
- `DB_VERSION` in `src/lib/db/db.ts` is not the app version. It moves independently, with
  its own migration.

Cut a release by moving the `## [Unreleased]` entries into a new
`## [x.y.z] - YYYY-MM-DD` section, bumping `package.json` and `package-lock.json`, then
tagging the merged commit on `main`:

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

Annotated tags, never lightweight. A pushed tag is never moved or deleted: fix forward
with the next patch version.

## Conventions

- Follow `RULES.md` rather than inventing a parallel style.
- Match the surrounding code, including its comment style: comments explain why, not what.
- Commits follow `COMMIT.md` (Conventional Commits). Do not claim verification you did not
  run.
- Reviews follow `REVIEW.md`: defects only, with a failure scenario and impact.
