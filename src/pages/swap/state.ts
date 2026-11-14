// Type imports only: `npm run test:release` loads this file with node type stripping.

import type { SwapBatch } from '@/lib/swap/swap-batch'
import type { SwapOperation } from '@/lib/swap/relay'
import type { SwapRunProgress } from '@/lib/swap/swap-run'
import type { SwapAmounts, SwapSpec } from '@/lib/swap/swap-spec'

export type SwapPreview = {
  readonly operation: SwapOperation
  readonly amountOut: bigint
}

// The resolved value keeps the key it was read for, so a retained batch or quote
// that no longer matches the composer is hidden instead of priced against it.
export type ResolvedSwapBatch = {
  key: string
  rowsKey: string
  batch: SwapBatch
}

export type ResolvedSwapPreview = {
  key: string
  preview: SwapPreview
}

export type SwapState = {
  walletIds: string[]
  spec: SwapSpec
  amounts: SwapAmounts
  resolved: ResolvedSwapBatch | null
  pending: boolean
  batchError: string | null
  preview: ResolvedSwapPreview | null
  previewPending: boolean
  running: boolean
  error: string | null
  progress: SwapRunProgress | null
}

export function createSwapState(spec: SwapSpec): SwapState {
  return {
    walletIds: [],
    spec,
    amounts: {},
    resolved: null,
    pending: false,
    batchError: null,
    preview: null,
    previewPending: false,
    running: false,
    error: null,
    progress: null,
  }
}
