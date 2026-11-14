import { createPageStore } from '@/lib/core/page-store'
import { createInstantSellState } from '@/pages/instant-sell/state'

// The route unmounts this page, so its scan, offer book and sale outlive the
// component here at module scope. A new scan overwrites the rows; nothing else
// clears it.
export const instantSellStore = createPageStore(createInstantSellState(), {
  retained: true,
})
