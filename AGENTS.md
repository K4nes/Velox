# AGENTS.md

Instructions for coding agents working in this repository. `RULES.md` is the binding
source for component, routing, layout and UI conventions; this file covers what you need
before touching code and points to it where it is the authority.

## Project

Velox is a single-page operator console for NFT work across stored EVM wallets: mint,
PnL, portfolio, bulk sell, instant sell, transfer, swap. React 19 + TypeScript + Vite 8,
Tailwind 4, shadcn/Animate UI components vendored into `src/components/ui/`.

There is no backend service. `server/` is a Vite plugin that mounts three routes on the dev
and preview servers, and the installed app signs in to OpenSea through its own commands,
because the sign-in cookie cannot pass through the webview. The web lane's routes:

- `/api/auth/nonce` returns an OpenSea SIWE message for an address.
- `/api/auth/token` verifies the signed message, mints an OpenSea token scoped
  `read:eligibility` with a one-day life, exchanges it for a short-lived access token, and
  revokes the minted token in a `finally`. The long-lived credential never reaches the
  browser.
- `/api/price/eth-usdt` returns the CoinMarketCap ETH/USDT quote.

All wallet signing happens locally with keys from IndexedDB.

## Commands

| Command | Use |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Dev server; the only mode with hot reload and the full app. |
| `npm run build` | `tsc -b` then `vite build`. The type-check gate. |
| `npm run build:desktop` | `tauri build`. Builds `dist/`, embeds it in the app, and bundles the NSIS installer under `src-tauri/target/release/bundle/nsis/`. Needs the Rust toolchain and the C++ build tools. |
| `npm run release:desktop` | Release build of the installer: signs it with the updater key, writes `latest.json` beside it, and prints the commands that tag the commit and open a draft release. `-- --draft` opens that draft itself; `-- --dry-run` prints the command without building. Needs `TAURI_SIGNING_PRIVATE_KEY`; `VELOX_WIN_CERT_THUMBPRINT` and `VELOX_WIN_TIMESTAMP_URL` add Authenticode. |
| `npm run release:verify` | Re-checks the installer, its `.sig` and `latest.json` in the bundle directory without rebuilding. |
| `npm run test:release` | Unit tests for the release manifest and the page-state store in `scripts/`. |
| `npm run lint` | oxlint. |
| `npm run preview` | Serves `dist/` with the same `/api` routes. |
| `npm run test:e2e` | Headless browser suite over `tests/**/*.e2e.ts`, mocked lane. Starts its own Vite server on a free port; no setup. |
| `npm run test:e2e:live` | Live lane through `e2e.live.config.ts` against real wallets, drops and providers. Needs the `E2E_*` values in `.env.e2e.local`. |
| `npm run test:e2e:mint` | Live lane over `tests/mint/live` only. Needs the same values as `test:e2e:live`. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | The app's own commands, driven against a stub upstream in `src-tauri/tests/`. Compiles the crate, so it needs `dist/` from `npm run build`. |

Two test runners exist: the `e2e` package drives a headless browser, and `cargo test` drives
the Rust commands. Do not claim a suite ran unless you ran it.

## Verify

Cheapest check that settles the change, in order:

1. Read the diff.
2. `npx tsc -b --force`
3. `npm run build`
4. `npm run test:release` — the release manifest, signature and lockfile logic, and the page-state store, in `scripts/`.
5. `npm run test:e2e` — the suite that covers the touched page.
6. `cargo test --manifest-path src-tauri/Cargo.toml` — the sign-in chain the installed app
   runs. `npm run build` has to have produced `dist/` first.
7. A browser run of the page — only when the task asks for it, or when the change cannot
   be settled any cheaper.

CI runs the same ladder, plus `node scripts/check-command-table.mjs`,
`node scripts/check-version-literal.mjs`, `node scripts/check-lockfile.mjs`,
`node scripts/check-workflow-secrets.mjs`, `node scripts/check-workflow-width.mjs` and the PR
title check, and gates `cargo fmt --check` and `cargo clippy -D warnings` for the crate, which
settle style rather than behaviour.

## Layout

| Path | Holds |
| --- | --- |
| `src/config/routes.tsx` | The route table: `path`, `title`, icon and element per route. `src/router.tsx` builds the data router from it. |
| `src/pages/` | Route components; the path mirrors the URL. Feature components colocate in `src/pages/<feature>/`. |
| `src/components/ui/` | Vendored shadcn + Animate UI primitives. |
| `src/components/layout/` | `app-layout`, `app-header`, `app-sidebar`, `app-context-menu`. |
| `src/components/` | Components shared by several pages (`wallet-select`, `empty-state`, `body-message`, `summary-row`, `run-status-cell`, `tx-hash-link`, `token-image`), plus the `dither-kit/` chart primitives, `lightswind/` toggle and `theme/` provider. |
| `src/lib/` | Domain logic: OpenSea, Seaport, Relay, PnL, transfer, swap, wallets, storage, clipboard. `chain/transport.ts` is the one module that picks between a `/api/*` route and an in-app command, so a caller never branches on the lane. |
| `src/hooks/` | Long-running flows and their run state (scans, listings, mints, swaps). |
| `src/config/` | Chains, routes, nav groups, swap assets. |
| `tests/` | E2E suites, one folder per feature; `live/` holds the ones that need real credentials. |
| `server/` | Vite middleware: SIWE proxy, CMC price route. |
| `src-tauri/` | The Tauri v2 shell: `tauri.conf.json`, `capabilities/default.json` (what the window may call), and `src/lib.rs` + `src/auth.rs` + `src/siwe.rs` + `src/price.rs` + `src/reply.rs`, the commands the installed app runs. `tests/` holds the stub-upstream suites. `scripts/desktop-check.mjs` checks the installed app. |
| `docs/` | Local research notes; not tracked by git. |

## Rules that break things if ignored

**Routes.** Add the route to `src/config/routes.tsx` with its `title`, and create the page
file at the matching path. `src/router.tsx` derives `handle: { title }` from the table, so
an entry written into the router by hand is not a route. The title renders once, in
`app-header`; never repeat it as an `h1` in the page body.

**Navigation.** Sidebar entries derive from the route table: `src/config/nav.ts` maps
`routeTable`, so a new route reaches the sidebar without a second edit. Active state is
derived from `useLocation`, never hardcoded.

**Vendored components.** A look that belongs to one page is a `className` at the call site.
Edit a file in `src/components/ui/` only when the change must hold for every instance.
`npx shadcn add` and `npx @animate-ui/cli animate` overwrite files from the registry; diff
every reported overwrite and re-apply the local edits.

**`src/lib/chain/connection-model.ts` stays free of runtime imports.** It holds types and
pure resolvers, so a type-stripped copy loads without a bundler or the `@/` alias. A
runtime import ends that. The rule holds even though nothing loads it that way today.

**The same holds for the files `npm run test:release` loads.** `src/lib/core/page-store.ts`
and `src/lib/inventory/holdings-fields.ts` have no runtime imports, and
`src/pages/bulk-sell/state.ts` imports only types and `holdings-fields`, and names that
module with a relative `.ts` path, because node strips the types without a bundler or the
`@/` alias.

**Storage.** IndexedDB schema changes need a `DB_VERSION` bump in `src/lib/db/db.ts` plus a
step in the `migrations` table in `src/lib/db/db-migrations.ts`. Those steps run from
`request.onupgradeneeded`, keyed by the version that brings a profile up to them.
`db.onversionchange` is a different handler: it closes this connection when another tab
upgrades the database. PnL records carry `v` on their nested `breakdown`. Readers test that
it is present (`'v' in stored`) to tell the current split from the legacy `invested` shape,
so a bump alone changes nothing at runtime; a new shape needs a new branch. localStorage
holds theme, active chain and the card image cache only.

**Secrets.** Wallet private keys are only used to sign locally, and leave the browser only
in the backup file the operator exports on purpose; that file is unencrypted and carries
provider API keys too. Provider API keys come from the browser store; the CoinMarketCap
key may also travel to `/api/price/eth-usdt` in a header or to the `eth_usdt_price` command
argument, and nothing else should. Do not log either kind. A new route under `server/`
needs a reason the browser cannot handle on its own.

**Chains.** `src/config/chains.ts` is the chain list. A new chain needs an entry there and
an RPC connection. Its native and wrapped swap options derive from that entry; add
`src/config/swap-assets.ts` entries only for extra tokens beyond the wrapped native.

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

### Desktop release

The installer carries two independent signing chains, which README describes under "Two
signing chains". The rules that bind work here:

- Authenticode is optional. Without a certificate the SmartScreen warning is expected.
- The updater key is mandatory. `requireSignedVersion` refuses an unsigned version.

`src-tauri/tauri.release.conf.json` is an overlay that turns on
`bundle.createUpdaterArtifacts`. Only `npm run release:desktop` passes it, so
`npm run build:desktop` keeps producing a plain installer with no `.sig`.

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which runs
`npm run release:desktop -- --draft` and leaves the installer, its `.sig` and `latest.json`
in a draft release. It never publishes.

The tag must equal `v` plus the package version. The job fails rather than ship unsigned
when the updater key is missing, when `WINDOWS_CERTIFICATE` arrives without its password,
and, once `VELOX_REQUIRE_AUTHENTICODE` is `true`, when the certificate is absent.

The updater reads its own keys from `tauri-plugin-updater`'s `config.rs`: `pubkey`,
`endpoints`, `requireSignedVersion`, `windows.installMode`. `@tauri-apps/cli`'s
`config.schema.json` describes only `bundle.createUpdaterArtifacts`, so a key absent from the
schema is not a key the plugin ignores.

The updater private key lives outside the repository at
`%USERPROFILE%\.velox\velox-updater.key`, with a backup in a second offline location. Only
the public key is committed, as `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
Never copy the private key into the repository.

## Conventions

- Follow `RULES.md` rather than inventing a parallel style.
- Match the surrounding code, including its comment style: comments explain why, not what.
- Commits follow `COMMIT.md` (Conventional Commits). Do not claim verification you did not
  run.
- Reviews follow `REVIEW.md`: defects only, with a failure scenario and impact.
