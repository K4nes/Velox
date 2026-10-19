import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/app-layout'
import { BulkSellPage } from '@/pages/bulk-sell'
import { InboxPage } from '@/pages/inbox'
import { InstantSellPage } from '@/pages/instant-sell'
import { MintEligibilityPage } from '@/pages/mint/eligibility'
import { MintTasksPage } from '@/pages/mint/tasks'
import { NotFoundPage } from '@/pages/not-found'
import { PnlCardPage } from '@/pages/pnl/card'
import { PnlLifetimePage } from '@/pages/pnl/lifetime'
import { PnlMonthlyPage } from '@/pages/pnl/monthly'
import { PortfolioPage } from '@/pages/portfolio'
import { SettingsPage } from '@/pages/settings'
import { SwapPage } from '@/pages/swap'
import { TransferPage } from '@/pages/transfer'
import { WalletProfilesPage } from '@/pages/wallet-profiles'

// A data router is required for `handle` and `useMatches`, which the header
// uses to read the current page title.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/mint/tasks" replace /> },
      {
        path: 'mint/tasks',
        element: <MintTasksPage />,
        handle: { title: 'Tasks' },
      },
      {
        path: 'mint/eligibility',
        element: <MintEligibilityPage />,
        handle: { title: 'Eligibility' },
      },
      { path: 'pnl/card', element: <PnlCardPage />, handle: { title: 'PnL Card' } },
      {
        path: 'pnl/monthly',
        element: <PnlMonthlyPage />,
        handle: { title: 'Monthly PnL' },
      },
      {
        path: 'pnl/lifetime',
        element: <PnlLifetimePage />,
        handle: { title: 'Lifetime PnL' },
      },
      { path: 'portfolio', element: <PortfolioPage />, handle: { title: 'Portfolio' } },
      { path: 'bulk-sell', element: <BulkSellPage />, handle: { title: 'Bulk Sell' } },
      {
        path: 'instant-sell',
        element: <InstantSellPage />,
        handle: { title: 'Instant Sell' },
      },
      { path: 'transfer', element: <TransferPage />, handle: { title: 'Transfer' } },
      { path: 'swap', element: <SwapPage />, handle: { title: 'Swap' } },
      {
        path: 'wallet-profiles',
        element: <WalletProfilesPage />,
        handle: { title: 'Wallet Profiles' },
      },
      { path: 'inbox', element: <InboxPage />, handle: { title: 'Inbox' } },
      { path: 'settings', element: <SettingsPage />, handle: { title: 'Settings' } },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
