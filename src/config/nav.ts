import type { LucideIcon } from 'lucide-react'
import { routeTable, type RouteBranch, type RouteLeaf } from '@/config/routes'

export type NavItem = {
  title: string
  icon: LucideIcon
  to: string
}

export type NavItemWithChildren = {
  title: string
  icon: LucideIcon
  prefix: string
  children: NavItem[]
}

export type NavGroup = {
  label: string
  items: (NavItem | NavItemWithChildren)[]
}

// A group is open while the URL sits under one of its routes, so the prefix is
// read off the child paths rather than written a second time.
function sharedPrefix(paths: string[]): string {
  const segments = paths.map((path) => path.split('/').filter(Boolean))
  const shared: string[] = []
  for (let index = 0; ; index += 1) {
    const segment = segments[0][index]
    if (segment === undefined) break
    if (!segments.every((parts) => parts[index] === segment)) break
    shared.push(segment)
  }
  return `/${shared.join('/')}`
}

const toNavItem = (leaf: RouteLeaf): NavItem => ({
  title: leaf.title,
  icon: leaf.icon,
  to: leaf.path,
})

const toNavItemWithChildren = (branch: RouteBranch): NavItemWithChildren => ({
  title: branch.title,
  icon: branch.icon,
  prefix: sharedPrefix(branch.children.map((child) => child.path)),
  children: branch.children.map(toNavItem),
})

export const navGroups: NavGroup[] = routeTable.map((group) => ({
  label: group.label,
  items: group.items.map((item) =>
    'children' in item ? toNavItemWithChildren(item) : toNavItem(item)
  ),
}))
