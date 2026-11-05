import { useState } from 'react'

import { useSwapBatch } from '@/hooks/use-swap-batch'
import { useSwapPreview } from '@/hooks/use-swap-preview'
import { useSwapRun } from '@/hooks/use-swap-run'
import { useWalletGroups } from '@/hooks/use-wallets'
import { defaultSwapSpec, explainSwapBlockers } from '@/lib/swap-spec'
import type { SwapSpec } from '@/lib/swap-spec'
import { SwapComposer } from '@/pages/swap/composer'
import { SwapRail } from '@/pages/swap/rail'
import { SwapWallets } from '@/pages/swap/wallets'

export function SwapPage() {
  const { groups } = useWalletGroups()
  const [walletIds, setWalletIds] = useState<string[]>([])
  const [spec, setSpec] = useState<SwapSpec>(defaultSwapSpec)

  const batch = useSwapBatch(spec, walletIds)
  const preview = useSwapPreview(spec, batch.value?.jobs[0] ?? null)
  const run = useSwapRun({ batch: batch.value, onSettled: batch.refresh })

  const blockedReason = explainSwapBlockers({
    spec,
    walletCount: walletIds.length,
    pending: batch.pending,
    batch: batch.value,
  })

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <SwapComposer
        groups={groups}
        walletIds={walletIds}
        onWalletIdsChange={setWalletIds}
        spec={spec}
        onSpecChange={setSpec}
        disabled={run.running}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <SwapWallets
          batch={batch.value}
          states={run.states}
          pending={batch.pending}
        />
        <SwapRail
          spec={spec}
          walletCount={walletIds.length}
          batch={batch.value}
          preview={preview.value}
          summary={run.summary}
          error={run.error ?? batch.error}
          blockedReason={blockedReason}
          running={run.running}
          onExecute={run.start}
        />
      </div>
    </div>
  )
}
