import { createPageStore } from '@/lib/core/page-store'
import { createTask } from '@/lib/mint/mint-task'
import {
  createMintEligibilityState,
  createMintTasksState,
} from '@/pages/mint/state'

// The route unmounts both pages, so their state outlives the components here at
// module scope. A run that is still signing keeps writing into its store.
export const mintTasksStore = createPageStore(
  createMintTasksState(createTask()),
  { retained: true }
)

export const mintEligibilityStore = createPageStore(createMintEligibilityState(), {
  retained: true,
})
