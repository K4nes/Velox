import { createPageStore } from '@/lib/core/page-store'
import { createBulkSellState } from '@/pages/bulk-sell/state'

// The route unmounts this page, so its state outlives the component here at module
// scope. A new scan overwrites it; nothing else clears it.
export const bulkSellStore = createPageStore(createBulkSellState(), {
  retained: true,
})
