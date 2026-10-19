import {
  ArrowLeftRight,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  CreditCard,
  Gem,
  Inbox,
  Infinity,
  ListChecks,
  PackageMinus,
  Settings,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  title: string
  icon: LucideIcon
  to: string
}

export type NavItemWithChildren = NavItem & {
  children: NavItem[]
}

export type NavGroup = {
  label: string
  items: (NavItem | NavItemWithChildren)[]
}

export const navGroups: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      {
        title: 'Mint',
        icon: Gem,
        to: '/mint',
        children: [
          { title: 'Tasks', icon: ListChecks, to: '/mint/tasks' },
          { title: 'Eligibility', icon: BadgeCheck, to: '/mint/eligibility' },
        ],
      },
      {
        title: 'PnL',
        icon: TrendingUp,
        to: '/pnl',
        children: [
          { title: 'PnL Card', icon: CreditCard, to: '/pnl/card' },
          { title: 'Monthly PnL', icon: CalendarDays, to: '/pnl/monthly' },
          { title: 'Lifetime PnL', icon: Infinity, to: '/pnl/lifetime' },
        ],
      },
      { title: 'Portfolio', icon: Briefcase, to: '/portfolio' },
      { title: 'Bulk Sell', icon: PackageMinus, to: '/bulk-sell' },
      { title: 'Instant Sell', icon: Zap, to: '/instant-sell' },
      { title: 'Transfer', icon: ArrowLeftRight, to: '/transfer' },
      { title: 'Swap', icon: Wallet, to: '/swap' },
      { title: 'Wallet Profiles', icon: Users, to: '/wallet-profiles' },
      { title: 'Inbox', icon: Inbox, to: '/inbox' },
      { title: 'Settings', icon: Settings, to: '/settings' },
    ],
  },
]
