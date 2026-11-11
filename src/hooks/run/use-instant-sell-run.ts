import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useRunGate } from '@/hooks/run/use-run-gate'
import { toMessage } from '@/lib/core/error-message'
import type { SellTarget } from '@/lib/offers/instant-sell'
import {
  runSellTargets,
  soldKeys,
  summarizeSell,
} from '@/lib/offers/sell-run'
import type {
  SellRunProgress,
  SellRunSummary,
} from '@/lib/offers/sell-run'
import { listWallets } from '@/lib/wallet/wallets'

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
  const gate = useRunGate('sale')
  const { setError } = gate
  const [progress, setProgress] = useState<SellRunProgress | null>(null)

  const summary = useMemo(
    () => (progress ? summarizeSell(progress) : null),
    [progress]
  )

  function reset() {
    setProgress(null)
    setError(null)
  }

  async function start(targets: readonly SellTarget[]) {
    if (targets.length === 0) return

    const session = await gate.begin()
    if (!session) return

    const { live, shouldAbort } = session
    const publish = (next: SellRunProgress) => {
      if (live()) setProgress(next)
    }

    setProgress(null)

    try {
      const wallets = await listWallets()
      const outcome = await runSellTargets({
        targets,
        wallets,
        onProgress: publish,
        shouldAbort,
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
    progress,
    error: gate.error,
    summary,
    start,
    reset,
  }
}
