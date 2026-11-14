// Type imports only: `npm run test:release` loads this file with node type stripping.

import type {
  HoldingSort,
  PortfolioScanState,
  RarityTierFilter,
} from '@/lib/inventory/portfolio'

export type PortfolioState = {
  url: string
  walletIds: string[]
  state: PortfolioScanState
  starting: boolean
  query: string
  tier: RarityTierFilter
  sort: HoldingSort
}

export function createPortfolioState(): PortfolioState {
  return {
    url: '',
    walletIds: [],
    state: { status: 'idle' },
    starting: false,
    query: '',
    tier: 'all',
    sort: 'rarest',
  }
}
