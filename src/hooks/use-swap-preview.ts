import { useEffect, useState } from 'react'

import { quoteSwap } from '@/lib/relay'
import type { SwapOperation } from '@/lib/relay'
import type { SwapBatchJob } from '@/lib/swap-batch'
import { specKey } from '@/lib/swap-spec'
import type { SwapSpec } from '@/lib/swap-spec'

export type SwapPreview = {
  readonly operation: SwapOperation
  readonly amountOut: bigint
}

const DEBOUNCE_MS = 500

// Advisory only: one quote for the first selected wallet, already resolved to
// an amount. Nothing in the run reads it.
export function useSwapPreview(
  spec: SwapSpec,
  job: SwapBatchJob | null
): { value: SwapPreview | null; pending: boolean } {
  const wallet = job?.address ?? null
  const amount = job?.amount ?? null
  const key = `${specKey(spec, [])}|${wallet ?? ''}|${
    amount === null ? '' : amount.toString()
  }`

  const [resolved, setResolved] = useState<{
    key: string
    preview: SwapPreview
  } | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (wallet === null || amount === null || amount === 0n) {
      setPending(false)
      return
    }

    let cancelled = false
    setPending(true)

    const timer = setTimeout(() => {
      quoteSwap({ spec, wallet, amount })
        .then((quote) => {
          if (cancelled) return
          setResolved({
            key,
            preview: {
              operation: quote.operation,
              amountOut: quote.amountOut,
            },
          })
        })
        .catch(() => {
          // An estimate that fails is simply absent; the run quotes for real.
          if (!cancelled) setResolved(null)
        })
        .finally(() => {
          if (!cancelled) setPending(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, spec, wallet, amount])

  return {
    value: resolved !== null && resolved.key === key ? resolved.preview : null,
    pending,
  }
}
