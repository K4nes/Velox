import { createPageStore } from '@/lib/core/page-store'
import { defaultSwapSpec } from '@/lib/swap/swap-spec'
import { createSwapState } from '@/pages/swap/state'

// The route unmounts this page, so the composer and the run outlive the component
// here at module scope. A reload starts from the creator above; nothing else clears it.
export const swapStore = createPageStore(createSwapState(defaultSwapSpec()), {
  retained: true,
})
