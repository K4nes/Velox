import { useEffect, useState } from 'react'

import { toMessage } from '@/lib/core/message'
import { resolveSwapBatch } from '@/lib/swap/swap-batch'
import type { SwapBatch } from '@/lib/swap/swap-batch'
import { amountFor, amountKey, specKey } from '@/lib/swap/swap-spec'
import type { SwapAmounts, SwapSpec } from '@/lib/swap/swap-spec'
import { listWallets } from '@/lib/wallet/wallets'

const DEBOUNCE_MS = 300

// The batch is the only writer of resolved amounts. `value` is non-null only
// while it still matches the current spec, selection, and every draft, so a run
// can never spend an amount the operator has already changed. `display` needs
// only the spec and selection, so rows stay mounted through an amount edit and
// the focused input survives the keystroke.
export function useSwapBatch(
  spec: SwapSpec,
  walletIds: readonly string[],
  amounts: SwapAmounts
): {
  value: SwapBatch | null
  display: SwapBatch | null
  pending: boolean
  error: string | null
  refresh: () => void
} {
  const rowsKey = specKey(spec, walletIds)
  const key = [
    rowsKey,
    ...walletIds.map((id) => amountKey(amountFor(amounts, id))),
  ].join('|')
  const [resolved, setResolved] = useState<{
    key: string
    rowsKey: string
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
            amounts,
            wallets: wallets.filter((wallet) => ids.has(wallet.id)),
          })
        )
        .then((batch) => {
          if (cancelled) return
          setResolved({ key, rowsKey, batch })
          setError(null)
        })
        .catch((failure) => {
          if (cancelled) return
          setResolved(null)
          setError(toMessage(failure))
        })
        .finally(() => {
          if (!cancelled) setPending(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, rowsKey, spec, walletIds, amounts, version])

  return {
    value: resolved !== null && resolved.key === key ? resolved.batch : null,
    display:
      resolved !== null && resolved.rowsKey === rowsKey ? resolved.batch : null,
    pending,
    error,
    refresh: () => setVersion((current) => current + 1),
  }
}
