import { EMPTY_HOLDINGS } from '../../lib/inventory/holdings-fields.ts'
import type { BulkSellFields } from '@/hooks/scan/use-bulk-sell-scan'
import type { ListingRunFields } from '@/hooks/run/use-listing-run'
import type { CancelFields } from '@/hooks/run/use-cancel-run'

export type BulkSellTab = 'create' | 'cancel'

export type BulkSellState = BulkSellFields &
  ListingRunFields & {
    // The rail keeps the tab the operator left it on, so a route change does not
    // send them back to the create form.
    tab: BulkSellTab
  }

export function createBulkSellState(): BulkSellState {
  return {
    ...EMPTY_HOLDINGS,
    selectedKeys: [],
    price: '',
    durationDays: 30,
    running: false,
    error: null,
    progress: null,
    tab: 'create',
  }
}

export function createCancelState(): CancelFields {
  return {
    listings: [],
    read: { status: 'idle' },
    running: false,
    error: null,
    progress: null,
  }
}
