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
| `components/ui/` | library components (shadcn + Animate UI) | vendored, don't edit |
| `components/layout/` | page chrome: `app-layout`, `app-header`, `app-sidebar` | wraps every route |
| `components/theme/` | `theme-provider` | app-wide provider |
| `components/lightswind/` | `toggle-theme` | different vendor, not read by the animate CLI |
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

`src/router.tsx` uses `createBrowserRouter`. A data router is required: `handle` and
`useMatches` (used by `app-header` to read the page title) do not work with
`<BrowserRouter>`.

Each route carries its title:

```tsx
{ path: 'mint/tasks', element: <MintTasksPage />, handle: { title: 'Tasks' } }
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

Files in `ui/` are vendored: do not edit them. Style a library component from
the call site with `className`, even when the same override appears on several
pages.

```tsx
<TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
<TabsTrigger value="check" className="focus-visible:ring-[1px]">
```

`shadcn add --overwrite` and `animate` re-run against the registry, so a local
edit inside `ui/` would be silently reverted anyway.

## UI conventions

One component, one build. These values came out of a three-pass audit of the pages;
a page that differs is a bug, not a variant.

### Page shell

- Container: `flex flex-1 flex-col gap-4 p-6`. Three page kinds differ, all listed under
  Deliberate exceptions: the `mint/tasks` workspace, the unbuilt placeholders and the 404
  page.
- The title lives on the route (`handle.title`) and renders once, in `app-header`.
  Never repeat it as an `h1` in the body.
- Target is 1024px and up. Below that only the chrome collapses — the shell, the scan bar
  and the table + rail split. Dense stat grids may still step at `sm`/`md`.

### Panel header

The bar at the top of a card that holds a table, a rail panel or a form.

```tsx
<div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
  <h2 className="truncate text-[13px] font-semibold">Held NFT Inventory</h2>
  <Badge variant="secondary">0 items</Badge>
</div>
```

48px tall, one divider, 16px inset, 13px semibold title; counts and filters on the right.
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
The page-level CTA is the last card's footer — `mt-auto shrink-0 border-t p-4`, button
`h-10 w-full`.

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

- `mint/tasks`: the task list, the collection bar and the inventory table have no header bar.
- `mint/tasks` is a workspace, not a document: `min-h-[calc(100svh-3rem)] flex-col p-6`,
  `lg:h-[calc(100svh-3rem)] lg:min-h-0 lg:overflow-hidden` - no `flex-1`, no `gap-4`.
- Unbuilt pages render `<div className="p-6" />`; the 404 page renders `<div className="p-6">`
  around its Return link. Both take their title from the route.
- `mint/eligibility`: the plain label row above the table is a scaffold that will hold the
  API values.
- Empty states keep their page copy and their height; only the table shape (one full-width
  row) is shared.

## Theme

`ThemeProvider` in `components/theme/theme-provider.tsx` is the single source of
truth. Only it touches `localStorage` and the `dark` class.

## Verification

Cheap checks first, stop at the first rung that settles it:

1. read the diff
2. `npx tsc -b --force`
3. `npm run build`
4. browser test — **only when asked**
