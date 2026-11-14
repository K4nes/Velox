import { useSwapBatch } from '@/hooks/data/use-swap-batch'
import { useSwapPreview } from '@/hooks/data/use-swap-preview'
import { useSwapRun } from '@/hooks/run/use-swap-run'
import { usePageStore } from '@/hooks/use-page-store'
import { useWalletGroups } from '@/hooks/data/use-wallets'
import {
  explainSwapBlockers,
  withAmountText,
  withMaxAmount,
} from '@/lib/swap/swap-spec'
import type { SwapSpec } from '@/lib/swap/swap-spec'
import { SwapComposer } from '@/pages/swap/composer'
import { SwapRail } from '@/pages/swap/rail'
import { SwapWallets } from '@/pages/swap/wallets'
import { swapStore } from '@/pages/swap/store'

export function SwapPage() {
  const { groups } = useWalletGroups()
  const { walletIds, spec, amounts } = usePageStore(swapStore)

  const batch = useSwapBatch(spec, walletIds, amounts, swapStore)
  const preview = useSwapPreview(spec, batch.value?.jobs[0] ?? null, swapStore)
  const run = useSwapRun({
    batch: batch.value,
    onSettled: batch.refresh,
    store: swapStore,
  })

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
        onWalletIdsChange={(ids) => swapStore.set({ walletIds: ids })}
        spec={spec}
        onSpecChange={(next: SwapSpec) => swapStore.set({ spec: next })}
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
            swapStore.set({
              amounts: withAmountText(swapStore.get().amounts, walletId, text),
            })
          }
          onMaxAmount={(walletId) =>
            swapStore.set({
              amounts: withMaxAmount(swapStore.get().amounts, walletId),
            })
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
