import { useEffect } from 'react'

import { usePageStore } from '@/hooks/use-page-store'
import type { PageStore } from '@/lib/core/page-store'
import { quoteSwap } from '@/lib/swap/relay'
import type { SwapBatchJob } from '@/lib/swap/swap-batch'
import { specKey } from '@/lib/swap/swap-spec'
import type { SwapSpec } from '@/lib/swap/swap-spec'
import type { SwapPreview, SwapState } from '@/pages/swap/state'

export type { SwapPreview } from '@/pages/swap/state'

const DEBOUNCE_MS = 500

// Advisory only: one quote for the first selected wallet, already resolved to
// an amount. Nothing in the run reads it. The quote itself is retained with the
// page, so it is still on screen after a round trip through another route.
export function useSwapPreview(
  spec: SwapSpec,
  job: SwapBatchJob | null,
  store: PageStore<SwapState>
): { value: SwapPreview | null; pending: boolean } {
  const { preview, previewPending } = usePageStore(store)
  const wallet = job?.address ?? null
  const amount = job?.amount ?? null
  const key = `${specKey(spec, [])}|${wallet ?? ''}|${
    amount === null ? '' : amount.toString()
  }`

  useEffect(() => {
    if (wallet === null || amount === null || amount === 0n) {
      store.set({ previewPending: false })
      return
    }

    // Kept off the store's scan epoch: the batch opens that one on every draft
    // change, and a second opener would drop the batch read it shares.
    let cancelled = false
    store.set({ previewPending: true })

    const timer = setTimeout(() => {
      quoteSwap({ spec, wallet, amount })
        .then((quote) => {
          if (cancelled) return
          store.set({
            preview: {
              key,
              preview: {
                operation: quote.operation,
                amountOut: quote.amountOut,
              },
            },
          })
        })
        .catch(() => {
          // An estimate that fails is simply absent; the run quotes for real.
          if (!cancelled) store.set({ preview: null })
        })
        .finally(() => {
          if (!cancelled) store.set({ previewPending: false })
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, spec, wallet, amount, store])

  return {
    value: preview !== null && preview.key === key ? preview.preview : null,
    pending: previewPending,
  }
}
