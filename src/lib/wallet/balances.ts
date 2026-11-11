import { balanceKey, type BalanceMap } from '@/lib/wallet/balance-key'
import { clientFor } from '@/lib/chain/tx'
import { mapLimitSettled } from '@/lib/core/async'

const CONCURRENCY = 5

export type BalanceResult = {
  balances: BalanceMap
  failed: string[]
}

export async function fetchBalances(
  chainSlug: string,
  addresses: string[]
): Promise<BalanceResult> {
  if (addresses.length === 0) {
    return { balances: new Map(), failed: [] }
  }

  const client = await clientFor(chainSlug)
  const { resolved, failed, firstError } = await mapLimitSettled(
    addresses,
    CONCURRENCY,
    (address) => client.getBalance({ address: address as `0x${string}` })
  )

  const balances: BalanceMap = new Map()
  for (const { item, value } of resolved) {
    balances.set(balanceKey(chainSlug, item), value)
  }

  // One rejected call (a rate-limited public RPC) must not wipe the balances
  // that did resolve, so the error surfaces only when nothing came back.
  if (balances.size === 0 && firstError !== null) {
    throw firstError
  }

  return { balances, failed }
}
