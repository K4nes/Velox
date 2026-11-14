import { useMemo } from 'react'
import { toast } from 'sonner'

import { useRun } from '@/hooks/run/use-run'
import type { RunState } from '@/hooks/run/use-run'
import type { PageStore } from '@/lib/core/page-store'
import { countFailed, failureLine } from '@/lib/core/run-engine'
import type { SellTarget } from '@/lib/offers/instant-sell'
import {
  runSellTargets,
  soldKeys,
  summarizeSell,
} from '@/lib/offers/sell-run'
import type { SellRunProgress, SellRunSummary } from '@/lib/offers/sell-run'
import { listWallets } from '@/lib/wallet/wallets'

export function useInstantSellRun(input: {
  onSold?: (keys: readonly string[]) => void
  onSettled?: () => void
  store: PageStore<RunState<SellRunProgress>>
}): {
  running: boolean
  progress: SellRunProgress | null
  error: string | null
  summary: SellRunSummary | null
  start: (targets: readonly SellTarget[]) => Promise<void>
  reset: () => void
} {
  const run = useRun<SellRunProgress>({
    kind: 'sale',
    store: input.store,
    onSettled: input.onSettled,
    onFinish: (progress) => {
      const keys = soldKeys(progress)
      if (keys.length > 0) input.onSold?.(keys)

      const failed = countFailed(progress.steps)
      if (failed > 0) {
        toast.error(failureLine(failed, progress.steps.length, 'offers'))
      }
    },
  })

  const summary = useMemo(
    () => (run.progress ? summarizeSell(run.progress) : null),
    [run.progress]
  )

  async function start(targets: readonly SellTarget[]) {
    if (targets.length === 0) return

    await run.start(async ({ publish, shouldAbort }) => {
      const wallets = await listWallets()
      return runSellTargets({
        targets,
        wallets,
        onProgress: publish,
        shouldAbort,
      })
    })
  }

  return {
    running: run.running,
    progress: run.progress,
    error: run.error,
    summary,
    start,
    reset: run.reset,
  }
}
