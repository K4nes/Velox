import { toast } from 'sonner'

import { usePageStore, usePageStoreScope } from '@/hooks/use-page-store'
import { useRunGate } from '@/hooks/run/use-run-gate'
import type { RunGateFields } from '@/hooks/run/use-run-gate'
import { toMessage } from '@/lib/core/message'
import type { PageStore } from '@/lib/core/page-store'
import type { RunOutcome } from '@/lib/core/run-engine'
import type { RunKind } from '@/lib/core/run-slot'

export type RunState<P> = RunGateFields & { progress: P | null }

export type RunBody<P> = (session: {
  // Dropped on a newer start, and on unmount when the store is per-mount, so a
  // late progress write cannot land.
  publish: (progress: P) => void
  shouldAbort: () => boolean
  // For a body that writes state of its own before the shared error branch runs.
  live: () => boolean
}) => Promise<RunOutcome<P>>

export type RunHook<P> = {
  running: boolean
  error: string | null
  setError: (message: string | null) => void
  progress: P | null
  // For a run that must drop the rows it produced, not just stop writing them.
  setProgress: (progress: P | null) => void
  reset: () => void
  start: (body: RunBody<P>) => Promise<void>
}

// The lifecycle every batch run shares: claim the slot, guard the writes, turn one error
// into copy, and settle the slot in that order. What the run does and how its result reads
// stay with the hook that knows the domain.
export function useRun<P>(input: {
  kind: RunKind
  // Extra state the surface keeps beside the progress.
  clear?: () => void
  onProgress?: (progress: P) => void
  // The run returned without an error. Toast or hand back its results here.
  onFinish?: (progress: P) => void
  onSettled?: () => void
  store?: PageStore<RunState<P>>
}): RunHook<P> {
  const scoped = usePageStoreScope(input.store, {
    running: false,
    error: null,
    progress: null,
  })
  const gate = useRunGate(input.kind, scoped)
  const fields = usePageStore(scoped)

  function setProgress(progress: P | null) {
    scoped.set({ progress })
  }

  function reset() {
    scoped.set({ progress: null, error: null })
    input.clear?.()
  }

  async function start(body: RunBody<P>) {
    const session = await gate.begin()
    if (!session) return

    const { live, shouldAbort } = session
    const publish = (next: P) => {
      if (!live()) return
      setProgress(next)
      input.onProgress?.(next)
    }

    setProgress(null)

    try {
      const outcome = await body({ publish, shouldAbort, live })
      if (!live()) return

      if (outcome.error) {
        // The gate owns the message the surface renders. The toast repeats it because the
        // operator is looking at the page, not at the rail.
        gate.setError(outcome.error)
        toast.error(outcome.error)
        return
      }

      input.onFinish?.(outcome.progress)
    } catch (failure) {
      if (!live()) return
      const message = toMessage(failure)
      gate.setError(message)
      toast.error(message)
    } finally {
      const alive = live()
      session.end()
      if (alive) input.onSettled?.()
    }
  }

  return {
    running: fields.running,
    error: fields.error,
    setError: gate.setError,
    progress: fields.progress,
    setProgress,
    reset,
    start,
  }
}
