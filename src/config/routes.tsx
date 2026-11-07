import type { ReactElement } from 'react'
import {
  ArrowLeftRight,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  CreditCard,
  Gem,
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
import { BulkSellPage } from '@/pages/bulk-sell'
import { InstantSellPage } from '@/pages/instant-sell'
import { MintEligibilityPage } from '@/pages/mint/eligibility'
import { MintTasksPage } from '@/pages/mint/tasks'
import { PnlCardPage } from '@/pages/pnl/card'
import { PnlLifetimePage } from '@/pages/pnl/lifetime'
import { PnlMonthlyPage } from '@/pages/pnl/monthly'
import { PortfolioPage } from '@/pages/portfolio'
import { SettingsPage } from '@/pages/settings'
import { SwapPage } from '@/pages/swap'
import { TransferPage } from '@/pages/transfer'
import { WalletProfilesPage } from '@/pages/wallet-profiles'

// The single route table. `router.tsx` derives its children from it and
// `config/nav.ts` derives the sidebar groups, so a path or a title is written
// once and cannot disagree with itself.
export type RouteLeaf = {
  path: string
  title: string
  icon: LucideIcon
  element: ReactElement
}

export type RouteBranch = {
  title: string
  icon: LucideIcon
  children: RouteLeaf[]
}

type RouteEntry = RouteLeaf | RouteBranch

export type RouteGroup = {
  label: string
  items: RouteEntry[]
}

export const routeTable: RouteGroup[] = [
  {
    label: 'Platform',
    items: [
      {
        title: 'Mint',
        icon: Gem,
        children: [
          {
            path: '/mint/tasks',
            title: 'Tasks',
            icon: ListChecks,
            element: <MintTasksPage />,
          },
          {
            path: '/mint/eligibility',
            title: 'Eligibility',
            icon: BadgeCheck,
            element: <MintEligibilityPage />,
          },
        ],
      },
      {
        title: 'PnL',
        icon: TrendingUp,
        children: [
          {
            path: '/pnl/card',
            title: 'PnL Card',
            icon: CreditCard,
            element: <PnlCardPage />,
          },
          {
            path: '/pnl/monthly',
            title: 'Monthly PnL',
            icon: CalendarDays,
            element: <PnlMonthlyPage />,
          },
          {
            path: '/pnl/lifetime',
            title: 'Lifetime PnL',
            icon: Infinity,
            element: <PnlLifetimePage />,
          },
        ],
      },
      {
        path: '/portfolio',
        title: 'Portfolio',
        icon: Briefcase,
        element: <PortfolioPage />,
      },
      {
        path: '/bulk-sell',
        title: 'Bulk Sell',
        icon: PackageMinus,
        element: <BulkSellPage />,
      },
      {
        path: '/instant-sell',
        title: 'Instant Sell',
        icon: Zap,
        element: <InstantSellPage />,
      },
      {
        path: '/transfer',
        title: 'Transfer',
        icon: ArrowLeftRight,
        element: <TransferPage />,
      },
      { path: '/swap', title: 'Swap', icon: Wallet, element: <SwapPage /> },
      {
        path: '/wallet-profiles',
        title: 'Wallet Profiles',
        icon: Users,
        element: <WalletProfilesPage />,
      },
      { path: '/settings', title: 'Settings', icon: Settings, element: <SettingsPage /> },
    ],
  },
]
