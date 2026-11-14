import { createPageStore } from '@/lib/core/page-store'
import { createPortfolioState } from '@/pages/portfolio/state'

// The route unmounts this page, so its state outlives the component here at module
// scope. A new scan overwrites it; nothing else clears it.
export const portfolioStore = createPageStore(createPortfolioState(), {
  retained: true,
})
