import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useRunGate } from '@/hooks/run/use-run-gate'
import { toMessage } from '@/lib/core/error-message'
import type { SwapBatch } from '@/lib/swap/swap-batch'
import { runSwapPlan, summarizeSwapRun, walletStates } from '@/lib/swap/swap-run'
import type {
  SwapRunProgress,
  SwapRunSummary,
  SwapWalletState,
} from '@/lib/swap/swap-run'
import { listWallets } from '@/lib/wallet/wallets'

export function useSwapRun(input: {
  batch: SwapBatch | null
  onSettled?: () => void
}): {
  running: boolean
  error: string | null
  summary: SwapRunSummary | null
  receivedTo: SwapRunProgress['to'] | null
  states: Map<string, SwapWalletState>
  start: () => Promise<void>
} {
  const gate = useRunGate('swap')
  const { setError } = gate
  const [progress, setProgress] = useState<SwapRunProgress | null>(null)

  const summary = useMemo(
    () => (progress ? summarizeSwapRun(progress) : null),
    [progress]
  )
  const states = useMemo(() => walletStates(progress), [progress])
  const receivedTo = progress?.to ?? null

  async function start() {
    const batch = input.batch
    if (batch === null || batch.jobs.length === 0) return

    const session = await gate.begin()
    if (!session) return

    const { live, shouldAbort } = session
    const publish = (next: SwapRunProgress) => {
      if (live()) setProgress(next)
    }

    setProgress(null)

    try {
      const wallets = await listWallets()
      const outcome = await runSwapPlan({
        batch,
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

      const result = summarizeSwapRun(outcome.progress)
      const parts: string[] = []
      if (result.done > 0) parts.push(`${result.done} done`)
      if (result.refunded > 0) parts.push(`${result.refunded} refunded`)
      if (result.failed > 0) parts.push(`${result.failed} failed`)
      if (result.unconfirmed > 0) {
        parts.push(`${result.unconfirmed} unconfirmed`)
      }
      if (result.active > 0) parts.push(`${result.active} still processing`)
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
      const message = parts.join(', ')

      if (message === '') return
      if (result.failed > 0) {
        toast.error(message)
      } else if (
        result.done > 0 &&
        result.unconfirmed === 0 &&
        result.refunded === 0 &&
        result.active === 0
      ) {
        toast.success(message)
      } else {
        toast.warning(message)
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
    error: gate.error,
    summary,
    receivedTo,
    states,
    start,
  }
}
