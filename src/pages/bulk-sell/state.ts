import { EMPTY_HOLDINGS } from '../../lib/inventory/holdings-fields.ts'
import type { BulkSellFields } from '@/hooks/scan/use-bulk-sell-scan'
import type { ListingRunFields } from '@/hooks/run/use-listing-run'

export type BulkSellState = BulkSellFields & ListingRunFields

export function createBulkSellState(): BulkSellState {
  return {
    ...EMPTY_HOLDINGS,
    selectedKeys: [],
    price: '',
    durationDays: 30,
    running: false,
    error: null,
    progress: null,
  }
}
