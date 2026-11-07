import { privateKeyToAccount } from 'viem/accounts'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/async'
import {
  createApprovalCache,
  ensureOperatorApproved,
} from '@/lib/approval'
import { buildFulfillmentCall } from '@/lib/fulfillment'
import type { SellTarget } from '@/lib/instant-sell'
import { requestOfferFulfillment } from '@/lib/opensea'
import { sendTransaction, waitForReceipt } from '@/lib/tx'
import { toPrivateKeyHex } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export type SellStepStatus =
  | 'queued'
  | 'preparing'
  | 'approving'
  | 'sending'
  | 'confirming'
  | 'sold'
  | 'failed'

export type SellStepState = {
  id: string
  tokenKey: string
  address: string
  label: string
  tokenId: string
  netWei: bigint
  symbol: string
  decimals: number
} & (
  | { status: 'queued' | 'preparing' | 'approving' }
  | { status: 'sending' }
  | { status: 'confirming'; txHash: string }
  | { status: 'sold'; txHash: string }
  | { status: 'failed'; error: string }
)

export type SellRunProgress = {
  steps: readonly SellStepState[]
}

export type SellRunSummary = {
  total: number
  sold: number
  failed: number
  netWei: bigint
  symbol: string | null
  decimals: number
}

export const SELL_STEP_LABEL: Record<SellStepStatus, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  approving: 'Approving',
  sending: 'Sending',
  confirming: 'Confirming',
  sold: 'Sold',
  failed: 'Failed',
}

export const SELL_STEP_TONE: Record<SellStepStatus, string> = {
  queued: 'text-muted-foreground',
  preparing: 'text-foreground',
  approving: 'text-foreground',
  sending: 'text-foreground',
  confirming: 'text-foreground',
  sold: 'text-primary',
  failed: 'text-destructive',
}

const WALLET_CONCURRENCY = 2

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runSellTargets(input: {
  targets: readonly SellTarget[]
  wallets: readonly StoredWallet[]
  onProgress?: (progress: SellRunProgress) => void
  shouldAbort?: () => boolean
}): Promise<{ progress: SellRunProgress; error: string | null }> {
  const records = new Map(
    input.wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])
  )

  let progress: SellRunProgress = {
    steps: input.targets.map((target) => ({
      id: target.key,
      tokenKey: target.key,
      address: target.address,
      label: target.label,
      tokenId: target.tokenId,
      netWei: target.offer.netWei,
      symbol: target.offer.currency.symbol,
      decimals: target.offer.currency.decimals,
      status: 'queued' as const,
    })),
  }
  input.onProgress?.(progress)

  for (const target of input.targets) {
    if (!records.has(target.address.toLowerCase())) {
      return {
        progress,
        error: `No saved wallet matches ${target.address}`,
      }
    }
  }

  for (const target of input.targets) {
    if (!chainBySlug(target.chain)) {
      return { progress, error: `Chain not supported: ${target.chain}` }
    }
    if (target.offer.chain !== target.chain) {
      return {
        progress,
        error: `Offer chain ${target.offer.chain} does not match ${target.chain}`,
      }
    }
  }

  const stateOf = (key: string): SellStepState | null =>
    progress.steps.find((step) => step.id === key) ?? null

  function commit(step: SellStepState) {
    progress = {
      ...progress,
      steps: progress.steps.map((current) =>
        current.id === step.id ? step : current
      ),
    }
    input.onProgress?.(progress)
  }

  function failAll(targets: readonly SellTarget[], message: string) {
    for (const target of targets) {
      const current = stateOf(target.key)
      if (current) commit({ ...current, status: 'failed', error: message })
    }
  }

  const byOwner = new Map<string, SellTarget[]>()
  for (const target of input.targets) {
    const owner = target.address.toLowerCase()
    const group = byOwner.get(owner) ?? []
    group.push(target)
    byOwner.set(owner, group)
  }

  const cache = createApprovalCache()

  async function runOwner(
    owner: string,
    targets: readonly SellTarget[],
    record: StoredWallet
  ): Promise<void> {
    let accountAddress: string
    try {
      accountAddress = privateKeyToAccount(
        toPrivateKeyHex(record.privateKey)
      ).address.toLowerCase()
    } catch (error) {
      failAll(targets, failureMessage(error))
      return
    }

    if (accountAddress !== owner) {
      failAll(
        targets,
        `Stored key signs as ${accountAddress}, not ${owner}`
      )
      return
    }

    for (const target of targets) {
      if (input.shouldAbort?.()) return

      if (target.offer.expiresAtSec <= Math.floor(Date.now() / 1000)) {
        const expired = stateOf(target.key)
        if (expired) {
          commit({
            ...expired,
            status: 'failed',
            error: 'Offer expired before it could be filled',
          })
        }
        continue
      }

      const preparing = stateOf(target.key)
      if (!preparing) continue
      commit({ ...preparing, status: 'preparing' })

      try {
        const transaction = await requestOfferFulfillment({
          offer: target.offer,
          fulfiller: target.address,
          contract: target.contract,
          tokenId: target.tokenId,
        })

        if (input.shouldAbort?.()) return

        const entry = chainBySlug(target.chain)
        if (!entry) throw new Error(`Chain not supported: ${target.chain}`)

        const call = buildFulfillmentCall({
          transaction,
          offer: target.offer,
          target,
          chainId: entry.chainId,
          nowSec: Math.floor(Date.now() / 1000),
        })

        await ensureOperatorApproved({
          wallet: record,
          chainSlug: target.chain,
          contract: target.contract as `0x${string}`,
          protocolAddress: target.offer.protocolAddress,
          fulfillerConduitKey: call.fulfillerConduitKey,
          cache,
          onApproving: () => {
            const approving = stateOf(target.key)
            if (approving) commit({ ...approving, status: 'approving' })
          },
          shouldAbort: input.shouldAbort,
        })

        if (input.shouldAbort?.()) return

        const sending = stateOf(target.key)
        if (!sending) return
        commit({ ...sending, status: 'sending' })

        const sent = await sendTransaction({
          wallet: record,
          chainSlug: target.chain,
          to: call.to,
          data: call.data,
          value: call.value,
          shouldAbort: input.shouldAbort,
        })

        const confirming = stateOf(target.key)
        if (confirming) {
          commit({ ...confirming, status: 'confirming', txHash: sent.txHash })
        }

        const receipt = await waitForReceipt(target.chain, sent.txHash)
        if (receipt === 'reverted') {
          throw new Error('Transaction reverted')
        }

        const sold = stateOf(target.key)
        if (sold) commit({ ...sold, status: 'sold', txHash: sent.txHash })
      } catch (error) {
        if (input.shouldAbort?.()) return
        const failed = stateOf(target.key)
        if (failed) {
          commit({ ...failed, status: 'failed', error: failureMessage(error) })
        }
      }
    }
  }

  await mapLimit(
    [...byOwner],
    WALLET_CONCURRENCY,
    async ([owner, targets]) => {
      if (input.shouldAbort?.()) return
      const record = records.get(owner)
      if (!record) return
      await runOwner(owner, targets, record)
    }
  )

  return { progress, error: null }
}

export function sellStepsByToken(
  progress: SellRunProgress
): Map<string, SellStepState> {
  const states = new Map<string, SellStepState>()
  for (const step of progress.steps) {
    states.set(step.tokenKey, step)
  }
  return states
}

export function soldKeys(progress: SellRunProgress): string[] {
  return progress.steps.flatMap((step) =>
    step.status === 'sold' ? [step.tokenKey] : []
  )
}

export function summarizeSell(progress: SellRunProgress): SellRunSummary {
  const summary: SellRunSummary = {
    total: 0,
    sold: 0,
    failed: 0,
    netWei: 0n,
    symbol: progress.steps[0]?.symbol ?? null,
    decimals: progress.steps[0]?.decimals ?? 18,
  }

  for (const step of progress.steps) {
    summary.total += 1
    if (step.status === 'sold') {
      summary.sold += 1
      summary.netWei += step.netWei
    }
    if (step.status === 'failed') summary.failed += 1
  }

  return summary
}
