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

## Theme

`ThemeProvider` in `components/theme/theme-provider.tsx` is the single source of
truth. Only it touches `localStorage` and the `dark` class.

## Verification

Cheap checks first, stop at the first rung that settles it:

1. read the diff
2. `npx tsc -b --force`
3. `npm run build`
4. browser test — **only when asked**
