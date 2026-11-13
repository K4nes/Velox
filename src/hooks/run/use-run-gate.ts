import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import type { PageStore } from '@/lib/core/page-store'
import {
  abortRunSlot,
  claimRunSlot,
  releaseRunSlot,
  runKindLabel,
} from '@/lib/core/run-slot'
import type { RunKind, RunSlot } from '@/lib/core/run-slot'

export type RunSession = {
  live: () => boolean
  shouldAbort: () => boolean
  end: () => void
}

export type RunGateFields = {
  running: boolean
  error: string | null
}

export function useRunGate(
  kind: RunKind,
  store: PageStore<RunGateFields>
): {
  setError: (message: string | null) => void
  begin: () => Promise<RunSession | null>
} {
  const slotRef = useRef<RunSlot | null>(null)

  useEffect(() => {
    // A retained run keeps submitting after its page unmounts, so only the per-mount
    // store abandons its slot for the next flow.
    if (store.retained) return
    return () => {
      if (slotRef.current) abortRunSlot(slotRef.current)
    }
  }, [store])

  function setError(message: string | null) {
    store.set({ error: message })
  }

  async function begin(): Promise<RunSession | null> {
    if (store.get().running) return null

    store.set({ running: true })

    const run = store.open('run')
    const claim = await claimRunSlot(
      kind,
      () => {
        if (run.live()) setError('Waiting for the previous run to finish')
      },
      () => !run.live()
    )

    if (claim.kind === 'stale') {
      store.set({ running: false })
      return null
    }

    if (claim.kind === 'busy') {
      if (run.live()) {
        const message = runKindLabel(claim.running)
        store.set({ running: false, error: message })
        toast.error(message)
      }
      return null
    }

    const slot = claim.slot
    slotRef.current = slot
    store.set({ error: null })

    return {
      live: run.live,
      shouldAbort: () => slot.aborted,
      end: () => {
        releaseRunSlot(slot)
        if (slotRef.current === slot) slotRef.current = null
        if (run.live()) store.set({ running: false })
      },
    }
  }

  return { setError, begin }
}
