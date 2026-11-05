import { useEffect, useState } from 'react'

import { resolveSwapBatch } from '@/lib/swap-batch'
import type { SwapBatch } from '@/lib/swap-batch'
import { specKey } from '@/lib/swap-spec'
import type { SwapSpec } from '@/lib/swap-spec'
import { listWallets } from '@/lib/wallets'

const DEBOUNCE_MS = 300

// The batch is the only writer of resolved amounts. `value` is non-null only
// while it still matches the current spec and selection, so a run can never
// spend an amount the operator has already changed.
export function useSwapBatch(
  spec: SwapSpec,
  walletIds: readonly string[]
): {
  value: SwapBatch | null
  pending: boolean
  error: string | null
  refresh: () => void
} {
  const key = specKey(spec, walletIds)
  const [resolved, setResolved] = useState<{
    key: string
    batch: SwapBatch
  } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (walletIds.length === 0) {
      setResolved(null)
      setPending(false)
      setError(null)
      return
    }

    let cancelled = false
    setPending(true)

    const timer = setTimeout(() => {
      const ids = new Set(walletIds)
      listWallets()
        .then((wallets) =>
          resolveSwapBatch({
            spec,
            wallets: wallets.filter((wallet) => ids.has(wallet.id)),
          })
        )
        .then((batch) => {
          if (cancelled) return
          setResolved({ key, batch })
          setError(null)
        })
        .catch((failure) => {
          if (cancelled) return
          setResolved(null)
          setError(failure instanceof Error ? failure.message : String(failure))
        })
        .finally(() => {
          if (!cancelled) setPending(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, spec, walletIds, version])

  return {
    value: resolved !== null && resolved.key === key ? resolved.batch : null,
    pending,
    error,
    refresh: () => setVersion((current) => current + 1),
  }
}
