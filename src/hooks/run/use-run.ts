import { useState } from 'react'
import { toast } from 'sonner'

import { useRunGate } from '@/hooks/run/use-run-gate'
import { toMessage } from '@/lib/core/error-message'
import type { RunOutcome } from '@/lib/core/run-engine'
import type { RunKind } from '@/lib/core/run-slot'

export type RunBody<P> = (session: {
  // Dropped on unmount and on a newer start, so a late progress write cannot land.
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
}): RunHook<P> {
  const gate = useRunGate(input.kind)
  const { setError } = gate
  const [progress, setProgress] = useState<P | null>(null)

  function reset() {
    setProgress(null)
    setError(null)
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
        setError(outcome.error)
        toast.error(outcome.error)
        return
      }

      input.onFinish?.(outcome.progress)
    } catch (failure) {
      if (!live()) return
      const message = toMessage(failure)
      setError(message)
      toast.error(message)
    } finally {
      const alive = live()
      session.end()
      if (alive) input.onSettled?.()
    }
  }

  return {
    running: gate.running,
    error: gate.error,
    setError,
    progress,
    setProgress,
    reset,
    start,
  }
}
