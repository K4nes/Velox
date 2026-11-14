import { useEffect, useState } from 'react'

import { usePageStore } from '@/hooks/use-page-store'
import { toMessage } from '@/lib/core/message'
import type { PageStore } from '@/lib/core/page-store'
import { resolveSwapBatch } from '@/lib/swap/swap-batch'
import type { SwapBatch } from '@/lib/swap/swap-batch'
import { amountFor, amountKey, specKey } from '@/lib/swap/swap-spec'
import type { SwapAmounts, SwapSpec } from '@/lib/swap/swap-spec'
import type { SwapState } from '@/pages/swap/state'
import { listWallets } from '@/lib/wallet/wallets'

const DEBOUNCE_MS = 300

// The batch is the only writer of resolved amounts. `value` is non-null only
// while it still matches the current spec, selection, and every draft, so a run
// can never spend an amount the operator has already changed. `display` needs
// only the spec and selection, so rows stay mounted through an amount edit and
// the focused input survives the keystroke. It lives in the page store because
// the route unmounts the hook, and a batch resolved before the operator left is
// still the batch they come back to.
export function useSwapBatch(
  spec: SwapSpec,
  walletIds: readonly string[],
  amounts: SwapAmounts,
  store: PageStore<SwapState>
): {
  value: SwapBatch | null
  display: SwapBatch | null
  pending: boolean
  error: string | null
  refresh: () => void
} {
  const { resolved, pending, batchError } = usePageStore(store)
  const [version, setVersion] = useState(0)

  const rowsKey = specKey(spec, walletIds)
  const key = [
    rowsKey,
    ...walletIds.map((id) => amountKey(amountFor(amounts, id))),
  ].join('|')

  useEffect(() => {
    if (walletIds.length === 0) {
      store.set({ resolved: null, pending: false, batchError: null })
      return
    }

    // The store's scan epoch, not a per-mount flag: a resolution that lands after
    // the operator moved on is kept rather than dropped, and a newer read still
    // wins over it.
    const read = store.open('scan')
    store.set({ pending: true })

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
          if (!read.live()) return
          store.set({ resolved: { key, rowsKey, batch }, batchError: null })
        })
        .catch((failure) => {
          if (!read.live()) return
          store.set({ resolved: null, batchError: toMessage(failure) })
        })
        .finally(() => {
          if (read.live()) store.set({ pending: false })
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [key, rowsKey, spec, walletIds, amounts, store, version])

  return {
    value: resolved !== null && resolved.key === key ? resolved.batch : null,
    display:
      resolved !== null && resolved.rowsKey === rowsKey ? resolved.batch : null,
    pending,
    error: batchError,
    refresh: () => setVersion((current) => current + 1),
  }
}
