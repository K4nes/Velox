import { failureMessage } from '@/lib/swap-chain'
import type { SwapRequest } from '@/lib/swap-plan'
import { sendTransaction, waitForReceipt } from '@/lib/tx'
import type { StoredWallet } from '@/lib/wallets'

export type SwapOutcome =
  | { kind: 'confirmed'; txHash: string }
  | { kind: 'reverted'; txHash: string }
  | { kind: 'unconfirmed'; txHash: string; message: string }

export async function executeSwap(input: {
  wallet: StoredWallet
  chainSlug: string
  request: SwapRequest
  onBroadcast?: (txHash: string) => void
}): Promise<SwapOutcome> {
  // Both fee caps are pinned, so broadcast signs them unchanged. Omitting either
  // re-estimates a tip that can rise past the cap the MAX reserve was built on.
  const { txHash } = await sendTransaction({
    wallet: input.wallet,
    chainSlug: input.chainSlug,
    to: input.request.to,
    data: input.request.data,
    value: input.request.value,
    gas: input.request.gas,
  })

  // Reported before the receipt wait: with a hash in hand the send can only be
  // re-checked, never re-sent.
  input.onBroadcast?.(txHash)

  try {
    return (await waitForReceipt(input.chainSlug, txHash)) === 'success'
      ? { kind: 'confirmed', txHash }
      : { kind: 'reverted', txHash }
  } catch (failure) {
    return { kind: 'unconfirmed', txHash, message: failureMessage(failure) }
  }
}
