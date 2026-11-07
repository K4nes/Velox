import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  abortRunSlot,
  claimRunSlot,
  releaseRunSlot,
  runKindLabel,
} from '@/lib/run-slot'
import type { RunKind, RunSlot } from '@/lib/run-slot'

export type RunSession = {
  live: () => boolean
  shouldAbort: () => boolean
  end: () => void
}

export function useRunGate(kind: RunKind): {
  running: boolean
  error: string | null
  setError: (message: string | null) => void
  begin: () => Promise<RunSession | null>
} {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runningRef = useRef(false)
  const epochRef = useRef(0)
  const slotRef = useRef<RunSlot | null>(null)

  useEffect(() => {
    const epoch = epochRef.current
    return () => {
      if (epochRef.current === epoch) epochRef.current += 1
      if (slotRef.current) abortRunSlot(slotRef.current)
    }
  }, [])

  async function begin(): Promise<RunSession | null> {
    if (runningRef.current) return null

    runningRef.current = true
    setRunning(true)

    const entryEpoch = epochRef.current
    const claim = await claimRunSlot(
      kind,
      () => {
        if (entryEpoch === epochRef.current) {
          setError('Waiting for the previous run to finish')
        }
      },
      () => entryEpoch !== epochRef.current
    )

    if (claim.kind === 'stale') {
      runningRef.current = false
      return null
    }

    if (claim.kind === 'busy') {
      runningRef.current = false
      if (entryEpoch === epochRef.current) {
        const message = runKindLabel(claim.running)
        setRunning(false)
        setError(message)
        toast.error(message)
      }
      return null
    }

    const slot = claim.slot
    slotRef.current = slot
    const epoch = epochRef.current
    const live = () => epoch === epochRef.current
    setError(null)

    return {
      live,
      shouldAbort: () => slot.aborted,
      end: () => {
        releaseRunSlot(slot)
        if (slotRef.current === slot) slotRef.current = null
        if (live()) {
          runningRef.current = false
          setRunning(false)
        }
      },
    }
  }

  return { running, error, setError, begin }
}
