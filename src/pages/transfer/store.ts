import { createPageStore } from '@/lib/core/page-store'
import { createTransferState } from '@/pages/transfer/state'

// The route unmounts this page, so its state outlives the component here at module
// scope. A new scan overwrites it; nothing else clears it.
export const transferStore = createPageStore(createTransferState(), {
  retained: true,
})
