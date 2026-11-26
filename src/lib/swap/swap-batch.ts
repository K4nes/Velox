import { assetKey, assetOptions } from '@/config/swap-assets'
import { mapLimit } from '@/lib/core/async'
import { BALANCE_CONCURRENCY } from '@/lib/core/concurrency'
import { readTokenBalance } from '@/lib/chain/erc20'
import { amountFor, parseFixedAmount } from '@/lib/swap/swap-spec'
import type { SwapAmounts, SwapSpec } from '@/lib/swap/swap-spec'
import { clientFor } from '@/lib/chain/tx'
import { addressKey } from '@/lib/wallet/address'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type SwapBatchJob = {
  readonly walletId: string
  readonly label: string
  readonly address: `0x${string}`
  readonly amount: bigint | null
  readonly available: bigint | null
  readonly balanceUnreadable: boolean
}

export type SwapBatch = {
  readonly spec: SwapSpec
  readonly jobs: readonly SwapBatchJob[]
  readonly total: bigint
  readonly shortfall: number
  readonly unresolved: number
  readonly balanceUnreadable: number
  // Two saved records can share one on-chain address (the same key imported into
  // two folders). Both pass a per-record balance check, then the second swap
  // spends a balance the first already spent and reverts after gas.
  readonly duplicateAddresses: readonly string[]
  readonly duplicateWallets: number
}

// One balance read per wallet; the client is hoisted because `clientFor`
// re-reads IndexedDB on every call.
export async function resolveSwapBatch(input: {
  spec: SwapSpec
  amounts: SwapAmounts
  wallets: readonly Pick<StoredWallet, 'id' | 'label' | 'address'>[]
}): Promise<SwapBatch> {
  const { spec } = input
  if (
    !assetOptions(spec.from.chain).some(
      (option) => assetKey(option.ref) === assetKey(spec.from.ref)
    )
  ) {
    throw new Error(
      `${spec.from.symbol} is not listed on ${spec.from.chain}`
    )
  }

  const client = await clientFor(spec.from.chain)
  const fromRef = spec.from.ref

  const jobs = await mapLimit(
    input.wallets,
    BALANCE_CONCURRENCY,
    async (wallet): Promise<SwapBatchJob> => {
      const address = wallet.address as `0x${string}`
      const draft = amountFor(input.amounts, wallet.id)
      const fixed = parseFixedAmount(draft, spec.from.decimals)
      const maxResolves = draft.kind === 'max' && fromRef.kind !== 'native'
      let available: bigint | null = null
      try {
        available =
          fromRef.kind === 'native'
            ? await client.getBalance({ address })
            : await readTokenBalance({
                client,
                token: fromRef.address,
                owner: address,
              })
      } catch {
        available = null
      }

      // A native `max` has no amount: spending the whole balance leaves no gas.
      const amount =
        draft.kind === 'max' ? (maxResolves ? available : null) : fixed
      const balanceUnreadable =
        available === null &&
        (draft.kind === 'max' || draft.text.trim() !== '')

      return {
        walletId: wallet.id,
        label: wallet.label,
        address,
        amount,
        available,
        balanceUnreadable,
      }
    }
  )

  let total = 0n
  let shortfall = 0
  let unresolved = 0
  let balanceUnreadable = 0
  const perAddress = new Map<string, number>()
  for (const job of jobs) {
    const key = addressKey(job.address)
    perAddress.set(key, (perAddress.get(key) ?? 0) + 1)

    if (job.balanceUnreadable) balanceUnreadable += 1
    if (job.amount === null) {
      unresolved += 1
      continue
    }
    total += job.amount
    if (job.available !== null && job.amount > job.available) shortfall += 1
  }

  const duplicateAddresses = [...perAddress.entries()]
    .filter(([, count]) => count > 1)
    .map(([address]) => address)
  const duplicateWallets = duplicateAddresses.reduce(
    (count, address) => count + (perAddress.get(address) ?? 0),
    0
  )

  return {
    spec,
    jobs,
    total,
    shortfall,
    unresolved,
    balanceUnreadable,
    duplicateAddresses,
    duplicateWallets,
  }
}
