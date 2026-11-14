// Type imports only: `npm run test:release` loads this file with node type stripping.

import { EMPTY_HOLDINGS } from '../../lib/inventory/holdings-fields.ts'
import type { BulkSellFields } from '@/hooks/scan/use-bulk-sell-scan'
import type { OffersState } from '@/hooks/data/use-collection-offers'
import type { RunState } from '@/hooks/run/use-run'
import type { SellRunProgress } from '@/lib/offers/sell-run'

export type InstantSellState = BulkSellFields &
  RunState<SellRunProgress> & {
    offers: OffersState
    // The operator's pick lives beside the book, so a refetch keeps the ladder
    // they were looking at instead of falling back to the first one.
    offersCurrency: string | null
  }

export function createInstantSellState(): InstantSellState {
  return {
    ...EMPTY_HOLDINGS,
    selectedKeys: [],
    offers: { status: 'idle' },
    offersCurrency: null,
    running: false,
    error: null,
    progress: null,
  }
}
