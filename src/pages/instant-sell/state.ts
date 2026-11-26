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
    // Units already sold, per token. A partial fill leaves the rest sellable,
    // and the next plan has to know the balance it can actually cover.
    soldUnits: Record<string, number>
  }

export function createInstantSellState(): InstantSellState {
  return {
    ...EMPTY_HOLDINGS,
    selectedKeys: [],
    offers: { status: 'idle' },
    offersCurrency: null,
    soldUnits: {},
    running: false,
    error: null,
    progress: null,
  }
}
