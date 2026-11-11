import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveRead } from '@/hooks/use-live-read'
import { balanceKey, type BalanceKey, type BalanceMap } from '@/lib/wallet/balance-key'
import { fetchBalances } from '@/lib/wallet/balances'
import { toMessage } from '@/lib/core/message'

type BalanceErrors = Record<string, { message: string; addresses: string[] }>

export function useWalletBalances(chainSlug: string, addressKey: string) {
  const [balances, setBalances] = useState<BalanceMap>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<BalanceErrors>({})
  const { open: openRead } = useLiveRead()
  const attemptedRef = useRef(new Set<BalanceKey>())

  const runRefresh = useCallback(
    async (addresses: string[]) => {
      const run = openRead()
      setLoading(true)

      try {
        const next = await fetchBalances(chainSlug, addresses)
        if (!run.live()) {
          return
        }
        // Only the addresses that came back are cached, so the refresh button
        // retries the rest instead of them staying blank for the session.
        for (const key of next.balances.keys()) {
          attemptedRef.current.add(key)
        }
        setBalances((current) => {
          const merged = new Map(current)
          for (const [key, value] of next.balances) {
            merged.set(key, value)
          }
          // A failed address keeps no value: an old number rendered as current
          // reads as a fresh balance the run never read.
          for (const address of next.failed) {
            merged.delete(balanceKey(chainSlug, address))
          }
          return merged
        })
        // This run only speaks for the addresses it asked for; a failure it did
        // not re-read still stands.
        setErrors((current) => {
          const failed = new Set(current[chainSlug]?.addresses ?? [])
          for (const address of addresses) {
            failed.delete(address.toLowerCase())
          }
          for (const address of next.failed) {
            failed.add(address.toLowerCase())
          }
          const state = { ...current }
          if (failed.size === 0) {
            delete state[chainSlug]
          } else {
            state[chainSlug] = {
              message: `${failed.size} balance${failed.size === 1 ? '' : 's'} could not be read.`,
              addresses: [...failed],
            }
          }
          return state
        })
      } catch (failure) {
        if (!run.live()) {
          return
        }
        // Nothing came back, so every cached value for this run is stale.
        setBalances((current) => {
          const merged = new Map(current)
          for (const address of addresses) {
            merged.delete(balanceKey(chainSlug, address))
          }
          return merged
        })
        setErrors((current) => {
          const failed = new Set(current[chainSlug]?.addresses ?? [])
          for (const address of addresses) {
            failed.add(address.toLowerCase())
          }
          return {
            ...current,
            [chainSlug]: {
              message:
                toMessage(failure),
              addresses: [...failed],
            },
          }
        })
      } finally {
        if (run.live()) {
          setLoading(false)
        }
      }
    },
    [chainSlug, openRead]
  )

  useEffect(() => {
    const present = new Set(
      addressKey ? addressKey.toLowerCase().split(',') : []
    )
    // A failure record survives only while the wallet it names is still here.
    // oxlint-disable-next-line react/set-state-in-effect
    setErrors((current) => {
      const entry = current[chainSlug]
      if (!entry) {
        return current
      }
      const kept = entry.addresses.filter((address) => present.has(address))
      if (kept.length === entry.addresses.length) {
        return current
      }
      const state = { ...current }
      if (kept.length === 0) {
        delete state[chainSlug]
      } else {
        state[chainSlug] = {
          message: `${kept.length} balance${kept.length === 1 ? '' : 's'} could not be read.`,
          addresses: kept,
        }
      }
      return state
    })

    if (!addressKey) {
      return
    }
    // A wallet mutation rewrites the key, and re-reading every address each time
    // would hammer the endpoint for values that are already cached.
    const pending = addressKey
      .split(',')
      .filter(
        (address) => !attemptedRef.current.has(balanceKey(chainSlug, address))
      )
    if (pending.length === 0) {
      return
    }
    // The effect exists to read the chain, and the loading flag has to flip
    // before the request so the refresh icon can spin during it.
    // oxlint-disable-next-line react/set-state-in-effect
    void runRefresh(pending)
  }, [addressKey, chainSlug, runRefresh])

  return {
    balances,
    loading,
    errorMessage: addressKey ? (errors[chainSlug]?.message ?? null) : null,
    runRefresh,
  }
}
