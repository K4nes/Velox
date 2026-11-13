import { privateKeyToAccount } from 'viem/accounts'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/core/async'
import { WALLET_CONCURRENCY } from '@/lib/core/concurrency'
import { toMessage } from '@/lib/core/message'
import { stepById, withStep } from '@/lib/core/run-progress'
import type { RunOutcome, RunProgress } from '@/lib/core/run-engine'
import { sendTransaction, waitForReceipt } from '@/lib/chain/tx'
import { cancelListing, requestCancelTransactions } from '@/lib/opensea/index'
import type { ActiveListing } from '@/lib/opensea/index'
import { openSeaStatus } from '@/lib/opensea/error'
import { cancelTypedData } from '@/lib/opensea/seaport'
import { addressKey, sameAddress } from '@/lib/wallet/address'
import { toPrivateKeyHex } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type CancelStepStatus =
  | 'queued'
  | 'signing'
  | 'cancelling'
  | 'cancelled'
  | 'failed'

export type CancelStepState = {
  id: string
  address: string
  label: string
} & (
  | { status: 'queued' | 'signing' | 'cancelling' }
  | { status: 'cancelled'; validUntilSec: number | null; txHash: string | null }
  | { status: 'failed'; error: string }
)

export type CancelRunProgress = RunProgress<CancelStepState>

export type CancelRunSummary = {
  total: number
  cancelled: number
  failed: number
}

export const CANCEL_STEP_LABEL: Record<CancelStepStatus, string> = {
  queued: 'Queued',
  signing: 'Signing',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

export const CANCEL_STEP_TONE: Record<CancelStepStatus, string> = {
  queued: 'text-muted-foreground',
  signing: 'text-foreground',
  cancelling: 'text-foreground',
  cancelled: 'text-primary',
  failed: 'text-destructive',
}

// OpenSea answers 400 for an order it will not cancel off-chain and 409 for one it
// cannot settle. Both are its own instruction to cancel on-chain. A rate limit, an
// auth failure and a missing order are not, and a 5xx is worth a retry instead.
function needsOnChainCancel(error: unknown): boolean {
  const status = openSeaStatus(error)
  return status === 400 || status === 409
}

export async function runCancelPlan(input: {
  listings: readonly ActiveListing[]
  wallets: readonly StoredWallet[]
  onProgress?: (progress: CancelRunProgress) => void
  shouldAbort?: () => boolean
}): Promise<RunOutcome<CancelRunProgress>> {
  const records = new Map(
    input.wallets.map((wallet) => [addressKey(wallet.address), wallet])
  )

  let progress: CancelRunProgress = {
    steps: input.listings.map((listing) => ({
      id: listing.orderHash,
      address: listing.offerer,
      label:
        records.get(addressKey(listing.offerer))?.label ?? listing.offerer,
      status: 'queued' as const,
    })),
  }
  input.onProgress?.(progress)

  for (const listing of input.listings) {
    if (!records.has(addressKey(listing.offerer))) {
      return { progress, error: `No saved wallet matches ${listing.offerer}` }
    }
    if (!chainBySlug(listing.chain)) {
      return { progress, error: `Chain not supported: ${listing.chain}` }
    }
  }

  function commit(step: CancelStepState) {
    progress = withStep(progress, step)
    input.onProgress?.(progress)
  }

  async function cancelOnChain(
    listing: ActiveListing,
    account: ReturnType<typeof privateKeyToAccount>,
    record: StoredWallet
  ): Promise<{ txHash: string | null }> {
    const transactions = await requestCancelTransactions({
      chain: listing.chain,
      protocolAddress: listing.protocolAddress,
      orderHash: listing.orderHash,
      address: account.address,
    })

    let txHash: string | null = null
    for (const transaction of transactions) {
      if (input.shouldAbort?.()) break
      const sent = await sendTransaction({
        wallet: record,
        chainSlug: listing.chain,
        to: transaction.to,
        data: transaction.data,
        value: BigInt(transaction.value),
        shouldAbort: input.shouldAbort,
      })
      txHash = sent.txHash
      const receipt = await waitForReceipt(listing.chain, sent.txHash)
      if (receipt === 'reverted') throw new Error('Cancellation reverted')
    }

    return { txHash }
  }

  async function cancelListingOffChain(
    listing: ActiveListing,
    account: ReturnType<typeof privateKeyToAccount>
  ): Promise<number | null> {
    const signature = await account.signTypedData(
      cancelTypedData({
        chainId: chainBySlug(listing.chain)?.chainId ?? 0,
        protocolAddress: listing.protocolAddress,
        orderHash: listing.orderHash,
      })
    )

    const { validUntilSec } = await cancelListing({
      chain: listing.chain,
      protocolAddress: listing.protocolAddress,
      orderHash: listing.orderHash,
      offererSignature: signature,
    })

    return validUntilSec
  }

  async function runWallet(record: StoredWallet): Promise<void> {
    const owned = input.listings.filter(
      (listing) => addressKey(listing.offerer) === addressKey(record.address)
    )
    if (owned.length === 0) return

    const failAll = (message: string) => {
      for (const listing of owned) {
        const current = stepById(progress, listing.orderHash)
        if (current && current.status !== 'cancelled') {
          commit({ ...current, status: 'failed', error: message })
        }
      }
    }

    let account: ReturnType<typeof privateKeyToAccount>
    try {
      account = privateKeyToAccount(toPrivateKeyHex(record.privateKey))
    } catch (error) {
      failAll(toMessage(error))
      return
    }

    // The off-chain cancel is signed by the offerer, so a stored key that signs as
    // another address would produce a signature OpenSea rejects for every order.
    if (!sameAddress(account.address, record.address)) {
      failAll(`Stored key signs as ${account.address}, not ${record.address}`)
      return
    }

    for (const listing of owned) {
      if (input.shouldAbort?.()) return

      const signing = stepById(progress, listing.orderHash)
      if (!signing || signing.status === 'cancelled') continue
      commit({ ...signing, status: 'signing' })

      try {
        const validUntilSec = await cancelListingOffChain(listing, account)
        const done = stepById(progress, listing.orderHash)
        if (done) {
          commit({
            ...done,
            status: 'cancelled',
            validUntilSec,
            txHash: null,
          })
        }
        continue
      } catch (error) {
        if (!needsOnChainCancel(error)) {
          const failed = stepById(progress, listing.orderHash)
          if (failed) commit({ ...failed, status: 'failed', error: toMessage(error) })
          continue
        }
      }

      const cancelling = stepById(progress, listing.orderHash)
      if (cancelling) commit({ ...cancelling, status: 'cancelling' })

      try {
        const { txHash } = await cancelOnChain(listing, account, record)
        const done = stepById(progress, listing.orderHash)
        if (done) {
          commit({ ...done, status: 'cancelled', validUntilSec: null, txHash })
        }
      } catch (error) {
        const failed = stepById(progress, listing.orderHash)
        if (failed) commit({ ...failed, status: 'failed', error: toMessage(error) })
      }
    }
  }

  await mapLimit(input.wallets, WALLET_CONCURRENCY, async (record) => {
    if (input.shouldAbort?.()) return
    await runWallet(record)
  })

  return { progress, error: null }
}

export function cancelSteps(
  progress: CancelRunProgress
): Map<string, CancelStepState> {
  return new Map(progress.steps.map((step) => [step.id, step]))
}

export function summarizeCancelRun(
  progress: CancelRunProgress
): CancelRunSummary {
  const summary: CancelRunSummary = { total: 0, cancelled: 0, failed: 0 }

  for (const step of progress.steps) {
    summary.total += 1
    if (step.status === 'cancelled') summary.cancelled += 1
    if (step.status === 'failed') summary.failed += 1
  }

  return summary
}

// The CTA cancels every order that is not confirmed cancelled yet, so a second
// press retries the failures and leaves the confirmed ones alone.
export function pendingCancels<T extends ActiveListing>(
  listings: readonly T[],
  progress: CancelRunProgress | null
): T[] {
  if (progress === null) return [...listings]

  const settled = new Set(
    progress.steps.flatMap((step) =>
      step.status === 'cancelled' ? [step.id] : []
    )
  )

  return listings.filter((listing) => !settled.has(listing.orderHash))
}
