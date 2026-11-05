import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { SellTarget } from '@/lib/instant-sell'
import {
  abortRunSlot,
  claimRunSlot,
  releaseRunSlot,
} from '@/lib/run-slot'
import type { RunSlot } from '@/lib/run-slot'
import {
  runSellTargets,
  soldKeys,
  summarizeSell,
} from '@/lib/sell-run'
import type {
  SellRunProgress,
  SellRunSummary,
} from '@/lib/sell-run'
import { listWallets } from '@/lib/wallets'

export function useInstantSellRun(input: {
  onSold?: (keys: readonly string[]) => void
  onSettled?: () => void
}): {
  running: boolean
  progress: SellRunProgress | null
  error: string | null
  summary: SellRunSummary | null
  start: (targets: readonly SellTarget[]) => Promise<void>
  reset: () => void
} {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<SellRunProgress | null>(null)
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

  const summary = useMemo(
    () => (progress ? summarizeSell(progress) : null),
    [progress]
  )

  function reset() {
    setProgress(null)
    setError(null)
  }

  async function start(targets: readonly SellTarget[]) {
    if (runningRef.current || targets.length === 0) return

    // Captured before any wait so a start that outlives its page cannot install
    // a slot nobody can abort.
    const entryEpoch = epochRef.current

    runningRef.current = true
    setRunning(true)

    const claim = await claimRunSlot('sale', () => {
      if (entryEpoch === epochRef.current) {
        setError('Waiting for the previous run to finish')
      }
    })

    if (claim.kind === 'busy') {
      runningRef.current = false
      if (entryEpoch === epochRef.current) {
        const message =
          claim.running === 'listing'
            ? 'A bulk sell run is still in progress'
            : 'An instant sell run is still in progress'
        setRunning(false)
        setError(message)
        toast.error(message)
      }
      return
    }

    if (entryEpoch !== epochRef.current) {
      releaseRunSlot(claim.slot)
      runningRef.current = false
      return
    }

    const slot = claim.slot
    slotRef.current = slot
    const epoch = epochRef.current
    const live = () => epoch === epochRef.current
    const publish = (next: SellRunProgress) => {
      if (live()) setProgress(next)
    }

    setError(null)
    setProgress(null)

    try {
      const wallets = await listWallets()
      const outcome = await runSellTargets({
        targets,
        wallets,
        onProgress: publish,
        shouldAbort: () => slot.aborted,
      })

      if (!live()) return

      if (outcome.error) {
        setError(outcome.error)
        toast.error(outcome.error)
        return
      }

      const keys = soldKeys(outcome.progress)
      if (keys.length > 0) input.onSold?.(keys)

      const failed = outcome.progress.steps.filter(
        (step) => step.status === 'failed'
      ).length
      if (failed > 0) {
        toast.error(
          `${failed} of ${outcome.progress.steps.length} offers failed`
        )
      }
    } catch (failure) {
      if (!live()) return
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
      toast.error(message)
    } finally {
      releaseRunSlot(slot)
      if (slotRef.current === slot) slotRef.current = null
      if (live()) {
        runningRef.current = false
        setRunning(false)
        input.onSettled?.()
      }
    }
  }

  return { running, progress, error, summary, start, reset }
}
