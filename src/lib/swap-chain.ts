import { clientFor } from '@/lib/tx'
import { WRAPPED_NATIVE_ABI } from '@/lib/swap-plan'
import type { SwapFees, SwapSnapshot, SwapVenue } from '@/lib/swap-plan'

export function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

// Never throws: every lane resolves to a null, the first rejection contributing
// its message, so a dead chain lands as a disabled CTA with a readable reason.
export async function readSwapSnapshot(input: {
  venue: SwapVenue
  address: string
}): Promise<SwapSnapshot> {
  try {
    const client = await clientFor(input.venue.chainSlug)
    const owner = input.address as `0x${string}`
    const [native, wrapped, fees] = await Promise.allSettled([
      client.getBalance({ address: owner }),
      client.readContract({
        address: input.venue.assets.wrapped.address,
        abi: WRAPPED_NATIVE_ABI,
        functionName: 'balanceOf',
        args: [owner],
      }),
      client.estimateFeesPerGas(),
    ])

    const rejection = [native, wrapped, fees].find(
      (lane) => lane.status === 'rejected'
    )
    const estimate = fees.status === 'fulfilled' ? fees.value : null

    // A legacy-fee estimate carries gasPrice instead, which cannot be pinned as
    // a 1559 cap; both fields have to land or the reserve has nothing to bound.
    const pinned: SwapFees | null =
      estimate &&
      typeof estimate.maxFeePerGas === 'bigint' &&
      typeof estimate.maxPriorityFeePerGas === 'bigint'
        ? {
            maxFeePerGas: estimate.maxFeePerGas,
            maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
          }
        : null

    return {
      balances: {
        native: native.status === 'fulfilled' ? native.value : null,
        wrapped: wrapped.status === 'fulfilled' ? wrapped.value : null,
      },
      fees: pinned,
      error:
        rejection && rejection.status === 'rejected'
          ? failureMessage(rejection.reason)
          : null,
    }
  } catch (failure) {
    return {
      balances: { native: null, wrapped: null },
      fees: null,
      error: failureMessage(failure),
    }
  }
}
