import { createPageStore } from '@/lib/core/page-store'
import {
  createPnlLifetimeState,
  createPnlMonthlyState,
} from '@/pages/pnl/state'

// The route unmounts each page, so the filters outlive the component here at module
// scope. A reload starts from the creators above; nothing else clears them.
export const pnlMonthlyStore = createPageStore(createPnlMonthlyState(), {
  retained: true,
})

export const pnlLifetimeStore = createPageStore(createPnlLifetimeState(), {
  retained: true,
})
