import { useState } from 'react'

import { useSwapBatch } from '@/hooks/data/use-swap-batch'
import { useSwapPreview } from '@/hooks/data/use-swap-preview'
import { useSwapRun } from '@/hooks/run/use-swap-run'
import { useWalletGroups } from '@/hooks/data/use-wallets'
import {
  defaultSwapSpec,
  explainSwapBlockers,
  withAmountText,
  withMaxAmount,
} from '@/lib/swap/swap-spec'
import type { SwapAmounts, SwapSpec } from '@/lib/swap/swap-spec'
import { SwapComposer } from '@/pages/swap/composer'
import { SwapRail } from '@/pages/swap/rail'
import { SwapWallets } from '@/pages/swap/wallets'

export function SwapPage() {
  const { groups } = useWalletGroups()
  const [walletIds, setWalletIds] = useState<string[]>([])
  const [spec, setSpec] = useState<SwapSpec>(defaultSwapSpec)
  const [amounts, setAmounts] = useState<SwapAmounts>({})

  const batch = useSwapBatch(spec, walletIds, amounts)
  const preview = useSwapPreview(spec, batch.value?.jobs[0] ?? null)
  const run = useSwapRun({ batch: batch.value, onSettled: batch.refresh })

  const blockedReason = explainSwapBlockers({
    spec,
    walletIds,
    amounts,
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
          batch={batch.display}
          amounts={amounts}
          states={run.states}
          pending={batch.pending}
          disabled={run.running}
          onAmountChange={(walletId, text) =>
            setAmounts((current) => withAmountText(current, walletId, text))
          }
          onMaxAmount={(walletId) =>
            setAmounts((current) => withMaxAmount(current, walletId))
          }
        />
        <SwapRail
          spec={spec}
          walletCount={walletIds.length}
          batch={batch.value}
          preview={preview.value}
          summary={run.summary}
          receivedTo={run.receivedTo}
          error={run.error ?? batch.error}
          blockedReason={blockedReason}
          running={run.running}
          onExecute={run.start}
        />
      </div>
    </div>
  )
}
