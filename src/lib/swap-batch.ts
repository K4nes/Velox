import { assetKey, assetOptions } from '@/config/swap-assets'
import { mapLimit } from '@/lib/async'
import { readTokenBalance } from '@/lib/erc20'
import { parseFixedAmount } from '@/lib/swap-spec'
import type { SwapSpec } from '@/lib/swap-spec'
import { clientFor } from '@/lib/tx'
import type { StoredWallet } from '@/lib/wallets'

export type SwapBatchJob = {
  readonly walletId: string
  readonly label: string
  readonly address: `0x${string}`
  readonly amount: bigint | null
  readonly available: bigint | null
}

export type SwapBatch = {
  readonly spec: SwapSpec
  readonly jobs: readonly SwapBatchJob[]
  readonly total: bigint
  readonly shortfall: number
  readonly unresolved: number
}

// One balance read per wallet; the client is hoisted because `clientFor`
// re-reads IndexedDB on every call.
const BALANCE_CONCURRENCY = 5

export async function resolveSwapBatch(input: {
  spec: SwapSpec
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
  const fixed = parseFixedAmount(spec.amount, spec.from.decimals)
  const maxResolves = spec.amount.kind === 'max' && fromRef.kind !== 'native'

  const jobs = await mapLimit(
    input.wallets,
    BALANCE_CONCURRENCY,
    async (wallet): Promise<SwapBatchJob> => {
      const address = wallet.address as `0x${string}`
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
        spec.amount.kind === 'max'
          ? maxResolves
            ? available
            : null
          : fixed

      return {
        walletId: wallet.id,
        label: wallet.label,
        address,
        amount,
        available,
      }
    }
  )

  let total = 0n
  let shortfall = 0
  let unresolved = 0
  for (const job of jobs) {
    if (job.amount === null) {
      unresolved += 1
      continue
    }
    total += job.amount
    if (job.available !== null && job.amount > job.available) shortfall += 1
  }

  return { spec, jobs, total, shortfall, unresolved }
}
