# Project Rules

Conventions for this repository, as decided during the build. Follow them unless a
request says otherwise.

## Components

### One folder for library components: `src/components/ui/`

Both CLIs depend on it:

- `npx shadcn@latest add <name>` writes to the `ui` alias in `components.json`
- `npx @animate-ui/cli@latest animate <name>` looks for "their file names in your ui folder"


### Adding a component: two steps, one breath

```bash
npx shadcn@latest add <name>        # writes to src/components/ui/
npx @animate-ui/cli@latest animate <name>   # swaps the primitive for Animate UI's
```

Preview first with `npx @animate-ui/cli@latest animate <name> --dry-run`.
Animate UI has no primitive for every component (`button`, `card`, `input`,
`separator`, `skeleton`); `animate` correctly leaves those alone.

### Folder responsibilities

| Folder | Contents | Rule |
| --- | --- | --- |
| `components/ui/` | library components (shadcn + Animate UI) | vendored; edit only what belongs to every instance |
| `components/layout/` | page chrome: `app-layout`, `app-header`, `app-sidebar`, `app-context-menu` | wraps every route |
| `components/theme/` | `theme-provider` | app-wide provider |
| `components/lightswind/` | `toggle-theme` | different vendor, not read by the animate CLI |
| `components/dither-kit/` | dithered chart primitives (`area-chart`, `tooltip`, `sparkline`, …) | different vendor; imported by the PnL pages |
| `pages/` | route components | mirrors the URL structure |
| `pages/<feature>/` | a page's own components | colocate while there is one consumer |
| `components/<name>.tsx` | a shared component used by several pages (e.g. `wallet-select.tsx`) | not in `ui/`, not in `layout/` |

Promote a colocated component to `components/` once a second page in the same domain
uses it. `wallet-select.tsx` is already there — it is expected on many pages.

### Imports in our own files

Use named imports, not `React.*`:

```tsx
import { useMemo, useState } from 'react'   // preferred
const [open, setOpen] = useState(false)
```

## Pages and routing

### Pages mirror the URL

```
/mint/tasks          → src/pages/mint/tasks.tsx
/mint/eligibility    → src/pages/mint/eligibility.tsx
/portfolio           → src/pages/portfolio.tsx
```

A route with sub-pages gets a folder. A route without sub-pages stays a flat file —
wrapping one file in its own folder adds depth for nothing.

### Routes live in one table

`src/config/routes.tsx` holds the single route table: every entry carries a `path`, a
`title`, an icon and an element. `src/router.tsx` builds the router from that table with
`createBrowserRouter` and derives `handle: { title }` per route, and `config/nav.ts` derives
the sidebar from the same table. A route written into `router.tsx` by hand is not a route;
the file maps the table.

A data router is required: `handle` and `useMatches` (used by `app-header` to read the page
title) do not work with `<BrowserRouter>`.

Each entry carries its title:

```tsx
{ path: '/mint/tasks', title: 'Tasks', icon: ListChecks, element: <MintTasksPage /> }
```

### Layout is a route layout

`AppLayout` renders `<Outlet />`; pages are child routes. It takes no props — the
title comes from the matched route.

### Active state comes from the URL

Never hardcode `isActive` in `config/nav.ts`. Derive it:

```tsx
<SidebarMenuButton asChild isActive={pathname.startsWith(item.to)}>
  <NavLink to={item.to}>…</NavLink>
</SidebarMenuButton>
```

## Editing `ui/`

Files in `ui/` are vendored, but not read-only. Two kinds of change, two homes.

**One call site, or a look that belongs to a page.** Style it at the call site with
`className`, even when the same override appears on several pages.

```tsx
<TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
<TabsTrigger value="check" className="focus-visible:ring-[1px]">
```

**Every instance, and repeating it at every call site is the worse trade.** Edit the
file in `ui/`. `autoComplete="off"` on `ui/input.tsx` is the worked example: it has to
hold for every input, and the one call site that forgets the prop is the bug the
default exists to prevent.

`shadcn add --overwrite` and `animate` re-run against the registry and would revert a
local edit. The command writes the named component and its `registryDependencies`, so one
re-add can rewrite several files. Diff every file the command reports as overwritten, not
just the one you named, and re-apply each edit.

## UI conventions

One component, one build. These values came out of a three-pass audit of the pages;
a page that differs is a bug, not a variant.

### Type scale

Stay on the app scale. Meta, labels and counts are 11px, values and control text are
`text-xs`, titles and panel headers are 13px, controls default to 14px. Nothing in a page
body goes below 11px, and no display size is introduced above the stat tile's 18px.

### Page shell

- Container: `flex flex-1 flex-col gap-4 p-6`. Four page kinds differ, each listed under
  Deliberate exceptions: the `mint/tasks` workspace, the 404 page, the `settings`
  master/detail page and the `portfolio` inventory page.
- The three table + rail pages — `bulk-sell`, `instant-sell`, `transfer` — add
  `lg:h-[calc(100svh-3rem)] lg:flex-none lg:min-h-0 lg:overflow-hidden` to that container, so
  the card body scrolls and the panel header stays put. Without it the whole page scrolls and
  the filter leaves the screen.
- The title lives on the route entry in `src/config/routes.tsx` and renders once, in
  `app-header`.
  Never repeat it as an `h1` in the body.
- Target is 1024px and up. Below that only the chrome collapses — the shell, the scan bar
  and the table + rail split. Dense stat grids may still step at `sm`/`md`.

### Panel header

The bar at the top of a card that holds a table, a rail panel or a form.

```tsx
<div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
  <div className="flex min-w-0 items-center gap-2">
    <h2 className="truncate text-[13px] font-semibold">Held NFT Inventory</h2>
    <Badge variant="secondary">0 items</Badge>
  </div>
  <Input className="w-60" placeholder="Filter by token" />
</div>
```

48px tall, one divider, 16px inset, 13px semibold title. The title and its row count
are one group on the left; the filter, where the page has one, sits alone on the right.
The card that owns it: `gap-0 overflow-hidden py-0`.

A title *inside* a card body is the same 13px semibold — not `CardTitle` (16px), not a
bare `p` at body size.

### Scan bar

The "collection URL + wallets + action" card.

```tsx
<Card className="gap-3 p-4 lg:flex-row lg:items-end">
  <div className="flex flex-1 flex-col gap-1.5">
    <label className="text-xs font-medium">Collection URL or slug (OpenSea / Scatter)</label>
    <Input />
  </div>
  <div className="flex flex-col gap-1.5 lg:w-[280px]" role="group">…WalletSelect…</div>
  <Button className="shrink-0">Check</Button>
</Card>
```

Visible 12px labels, controls at the `Input` default (32px), wallet column 280px. The
wallet field is labelled `Wallet` on every page. `mint/tasks` keeps this shape without a
wallet field — its wallets live in the config panel.

### Table

- Header label: `text-muted-foreground px-3 text-xs font-medium` on every `TableHead`.
- A table card opens with a 48px bar (`h-12 px-4`): title and row count where the page has
  them, the filter (`w-60`) where it has one. The pnl tables use the same bar for search
  and sort only. No table starts directly at the column labels.
- Empty body: one row spanning the full width, centred and muted. Its height is not
  standardised — see the deliberate exceptions.

### Rail

The fixed right-hand column of a workspace page.

```tsx
<div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
  <Card className="min-w-0 flex-1 …">table</Card>
  <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">cards</div>
</div>
```

300px at `lg` and up, full width below it: the rail never sits beside the table under `lg`.
`transfer` is the exception at 340px, because its rail carries the grouped selection; it sits beside the table at `xl` and stacks below it under `xl`.
The page-level CTA is the last card's footer — `mt-auto shrink-0 border-t p-4`, button
`h-10 w-full`.
A batch whose parameters live outside the rail, in the card above the table (`swap`), keeps
them there, but its CTA lives in the rail footer beside the blocked reason, run error, and
progress that decide whether it can be pressed. All four batch pages (`bulk-sell`,
`instant-sell`, `transfer`, `swap`) follow the rail footer rule.

### Controls

| Role | Value |
| --- | --- |
| field label | `text-xs font-medium` |
| input / select | default `h-8` (32px) |
| filter input | `w-60` |
| filter row | `h-12` + `px-4` (the divider belongs to the bar above) |
| toolbar action | default (32px) |
| page-level CTA | `h-10` (40px) |

Sort selects carry an `aria-label`; no visible `Sort:` prefix.

Wallet pickers: multi-select uses `Checkbox`; `single` renders native radios sharing one
`name`, so the browser exposes them as a single group. Don't wrap the list in
`role="radiogroup"` - the groups collapse, so that container holds no radio in the default
state. A checked radio never clears itself - don't write a deselect branch.

### Stat tile

Label `text-[11px] font-medium tracking-wide uppercase`, value `text-lg font-semibold`,
secondary `text-[11px]`. Page-level tiles use this scale; the three-up strip inside
`instant-sell` stays at 13px because it is a dense summary, not a headline.

### Deliberate exceptions

Do not normalise these:

- `settings`: the provider master/detail split keeps both panes scrollable, so it pins a
  height only at `xl` (`xl:h-[calc(100svh-3rem)]`). Below `xl`, inside the 1024px target,
  the panes stack on purpose and the page scrolls; the left list gets a fixed height so its
  own body still scrolls.
- `portfolio`: it does not pin the shell, so its page scrolls and the inventory bar leaves the
  screen on a short window. Its shell also carries the collection header, six stat tiles and
  the rarity filter, which are about 350px, so pinning the shell leaves the table a sliver at
  1440x560. Collapsing that chrome is its own change, not a copy of the three pages above
  (issue #105).
- `mint/tasks`: the task list, the collection bar and the run table
  (`src/pages/mint/run-table.tsx`) have no header bar.
- `mint/tasks`: the Mint Stage picker lists every stage in the drop, on purpose. OpenSea picks
  the stage server-side, so the picker is how the operator targets the stage they mean to mint
  and reads that stage's price and cap. It is a configuration choice, not a claim about which
  stage the endpoint will choose, and it must not be narrowed to the active stage.
- `mint/tasks`: a re-check keeps the stage the operator picked. Checking again re-reads the drop
  and the eligibility, but it must not move the picker: `check()` keeps `stageUuid` whenever the
  new drop still lists that stage and only falls back to the live one when it does not. Defaulting
  every check back to the live stage throws away the target the operator set up.
- `mint/tasks`: Start Mint is a countdown, not a gate. A stage that has not opened yet keeps
  Start Mint usable: pressing it arms the task, the button counts down against block time read
  from the chain RPC, never the desktop clock, and the mint runs by itself the moment the stage
  opens. Never disable Start Mint because the selected stage is not the live one; that turns a
  scheduled mint into a dead button. The endpoint mints whatever stage is live, so the armed run
  re-reads the drop at zero and sends only once the targeted stage is the live one.
- `mint/tasks`: the quantity ceiling is whatever OpenSea returns, never a constant in this app.
  Read it from `max_per_wallet` on the stage and `max_total_mintable_by_wallet` from the
  eligibility check, take the smaller non-zero value, and leave the input unbounded when neither
  has answered. Do not reintroduce a hardcoded 100 or any other ceiling.
- `mint/tasks`: a row that reached the chain keeps its record through every re-check. Its
  `mintedStages` list and its latest `txHash` survive a check whichever stage is selected, because
  dropping them hides a landing and re-arms the wallet on that stage. `mintableRow` retires a wallet
  for every stage in that list, since each stage carries its own cap. A row shows one attempt at a
  time: starting a new mint replaces `status` and `txHash`, but never the list.
- `mint/tasks`: FCFS stays disabled. `Mint Mode` renders the button with `title="Not available
  yet"` and no handler behind it. Enabling it is a feature, not a cleanup.
- `mint/tasks`: no status line under the collection field. Tasks mint independently, so one task
  minting must never disable or explain another; check and mint failures surface as toasts, not
  as a bar under the URL. Do not reintroduce `Another task is minting` or `Drop is not minting`.
- `mint/tasks` is a workspace, not a document: `min-h-[calc(100svh-3rem)] flex-col p-6`,
  `lg:h-[calc(100svh-3rem)] lg:min-h-0 lg:overflow-hidden` - no `flex-1`, no `gap-4`.
- The 404 page renders `<div className="p-6">` around its `Go to Tasks` link, and takes its
  title from the route.
- Empty states keep their page copy and their height. Use the shared components in
  `src/components/`: `BodyMessage` for an icon-and-copy message inside a batch inventory
  card body (`bulk-sell`, `instant-sell`, `transfer`), because it brings its own centring
  box, and `EmptyState` for a bare icon-and-copy column that the call site centres. Tables
  whose empty body is a single muted centred row (`portfolio`, `mint/tasks`,
  `mint/eligibility`, `wallet-profiles`) keep that shape.

## Theme

`ThemeProvider` in `components/theme/theme-provider.tsx` is the single source of
truth for theme state. Only it touches the theme's `localStorage` entry and the `dark`
class. Other preferences keep their own key and their own owner, as `wallet-chain` does
in `wallet-profiles`.

## Verification

`AGENTS.md` owns the verification ladder. Run it in order and stop at the first rung that
settles the change. This file adds no rungs of its own, which is what stopped the two lists
drifting apart.

## E2E live data and mocks

- Live E2E tests MUST take external identity from environment variables or
  explicit test options: collection URL/slug, wallet key/address/label,
  expected status, chain, RPC and API endpoints. Never hardcode a specific
  drop, wallet, address, or expected status in a live test. Skip clearly when
  the required env is absent. A live check that cannot be parameterized is a
  one-off script, not suite material.
- Reusable mock helpers and fixtures MUST accept the collection, slug, stage,
  address, and response values as options. A helper must not embed one fixture
  case. A deterministic test may pass specific values into those helpers; the
  specificity belongs to the test or its fixture builder, not the shared
  helper.
- Put local env values in the ignored `.env.e2e.local`. Never commit secret
  values; document only the variable names.
