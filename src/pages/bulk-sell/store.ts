import { createPageStore } from '@/lib/core/page-store'
import { createBulkSellState, createCancelState } from '@/pages/bulk-sell/state'

// The route unmounts this page, so its state outlives the component here at module
// scope. A new scan overwrites it; nothing else clears it.
export const bulkSellStore = createPageStore(createBulkSellState(), {
  retained: true,
})

// The cancel tab reads and runs on its own state, so a cancel cannot overwrite the
// listing run's progress and the rail can show both while the page is open.
export const bulkSellCancelStore = createPageStore(createCancelState(), {
  retained: true,
})
