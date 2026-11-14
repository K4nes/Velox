import { useMemo } from 'react'
import { toast } from 'sonner'

import { useRun } from '@/hooks/run/use-run'
import type { PageStore } from '@/lib/core/page-store'
import type { SwapBatch } from '@/lib/swap/swap-batch'
import {
  runSwapPlan,
  summarizeSwapRun,
  walletStates,
} from '@/lib/swap/swap-run'
import type {
  SwapRunProgress,
  SwapRunSummary,
  SwapWalletState,
} from '@/lib/swap/swap-run'
import type { SwapState } from '@/pages/swap/state'
import { listWallets } from '@/lib/wallet/wallets'

export function useSwapRun(input: {
  batch: SwapBatch | null
  onSettled?: () => void
  store: PageStore<SwapState>
}): {
  running: boolean
  error: string | null
  summary: SwapRunSummary | null
  receivedTo: SwapRunProgress['to'] | null
  states: Map<string, SwapWalletState>
  start: () => Promise<void>
} {
  const run = useRun<SwapRunProgress>({
    kind: 'swap',
    // The run outlives the route: progress keeps landing on the retained store and
    // no unmount aborts the wallets still in flight.
    store: input.store,
    onSettled: input.onSettled,
    onFinish: (progress) => toastSwapResult(summarizeSwapRun(progress)),
  })

  const summary = useMemo(
    () => (run.progress ? summarizeSwapRun(run.progress) : null),
    [run.progress]
  )
  const states = useMemo(() => walletStates(run.progress), [run.progress])

  async function start() {
    const batch = input.batch
    if (batch === null || batch.jobs.length === 0) return

    await run.start(async ({ publish, shouldAbort }) => {
      const wallets = await listWallets()
      return runSwapPlan({
        batch,
        wallets,
        onProgress: publish,
        shouldAbort,
      })
    })
  }

  return {
    running: run.running,
    error: run.error,
    summary,
    receivedTo: run.progress?.to ?? null,
    states,
    start,
  }
}

// One line per outcome, because a swap can end in six ways at once across wallets.
function toastSwapResult(result: SwapRunSummary) {
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
}
