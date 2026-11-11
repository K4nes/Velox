import { privateKeyToAccount } from 'viem/accounts'
import type { PrivateKeyAccount } from 'viem/accounts'

import { chainBySlug } from '@/config/chains'
import type { ChainSlug } from '@/config/chains'
import type { SwapAssetOption } from '@/config/swap-assets'
import { mapLimit } from '@/lib/core/async'
import { toMessage } from '@/lib/core/error-message'
import { notifyIndexer, pollSwapIntent, quoteSwap } from '@/lib/relay'
import type {
  SwapIntentStatus,
  SwapQuote,
  SwapTx,
  SwapTxStep,
} from '@/lib/relay'
import type { SwapBatch, SwapBatchJob } from '@/lib/swap-batch'
import { withStep } from '@/lib/core/run-progress'
import {
  BroadcastError,
  WALLET_CONCURRENCY,
  sendTransaction,
  waitForReceiptOutcome,
} from '@/lib/chain/tx'
import { toPrivateKeyHex } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type SwapTxRef = { readonly chain: ChainSlug; readonly hash: string }

export type SwapWalletStatus =
  | 'queued'
  | 'quoting'
  | 'signing'
  | 'confirming'
  | 'waiting'
  | 'done'
  | 'refunded'
  | 'failed'
  | 'unconfirmed'
  | 'skipped'

export type SwapWalletState = {
  readonly id: string
  readonly label: string
  readonly address: `0x${string}`
  readonly amount: bigint | null
} & (
  | { readonly status: 'queued' }
  | { readonly status: 'quoting' }
  | { readonly status: 'signing'; readonly step: string }
  | {
      readonly status: 'confirming'
      readonly step: string
      readonly tx: SwapTxRef
    }
  | {
      readonly status: 'waiting'
      readonly tx: SwapTxRef
      readonly detail: string | null
    }
  | {
      readonly status: 'done'
      readonly tx: SwapTxRef
      readonly received: bigint
    }
  | {
      readonly status: 'refunded'
      readonly tx: SwapTxRef
      readonly reason: string | null
    }
  | {
      readonly status: 'failed'
      readonly error: string
      readonly tx: SwapTxRef | null
    }
  | {
      readonly status: 'unconfirmed'
      readonly tx: SwapTxRef
      readonly error: string
    }
  | { readonly status: 'skipped'; readonly reason: string }
)

export type SwapRunProgress = {
  readonly steps: readonly SwapWalletState[]
  readonly to: SwapAssetOption
}

export type SwapRunOutcome = {
  readonly progress: SwapRunProgress
  readonly error: string | null
}

export type SwapRunSummary = {
  readonly total: number
  readonly active: number
  readonly done: number
  readonly refunded: number
  readonly failed: number
  readonly unconfirmed: number
  readonly skipped: number
  readonly received: bigint
}

const SETTLE_CONCURRENCY = 4

type Broadcast = {
  ref: SwapTxRef
  from: `0x${string}`
  nonce: number
}

async function broadcastStep(input: {
  wallet: StoredWallet
  tx: SwapTx
  shouldAbort?: () => boolean
}): Promise<Broadcast> {
  try {
    const sent = await sendTransaction({
      wallet: input.wallet,
      chainSlug: input.tx.chain,
      to: input.tx.to,
      data: input.tx.data,
      value: input.tx.value,
      shouldAbort: input.shouldAbort,
    })
    return {
      ref: { chain: input.tx.chain, hash: sent.txHash },
      from: sent.from,
      nonce: sent.nonce,
    }
  } catch (error) {
    if (error instanceof BroadcastError) {
      return {
        ref: { chain: input.tx.chain, hash: error.txHash },
        from: error.from,
        nonce: error.nonce,
      }
    }
    throw error
  }
}

type SettleEntry = {
  job: SwapBatchJob
  sent: Broadcast
  quote: SwapQuote
  step: SwapTxStep
}

export async function runSwapPlan(input: {
  batch: SwapBatch
  wallets: readonly StoredWallet[]
  onProgress?: (progress: SwapRunProgress) => void
  shouldAbort?: () => boolean
}): Promise<SwapRunOutcome> {
  const records = new Map(
    input.wallets.map((wallet) => [wallet.id, wallet] as const)
  )

  let progress: SwapRunProgress = {
    steps: input.batch.jobs.map((job) => ({
      id: job.walletId,
      label: job.label,
      address: job.address,
      amount: job.amount,
      status: 'queued' as const,
    })),
    to: input.batch.spec.to,
  }
  const emit = () => input.onProgress?.(progress)

  emit()

  for (const job of input.batch.jobs) {
    if (!records.has(job.walletId)) {
      return { progress, error: `No saved wallet matches ${job.address}` }
    }
  }
  if (!chainBySlug(input.batch.spec.from.chain)) {
    return {
      progress,
      error: `Chain not supported: ${input.batch.spec.from.chain}`,
    }
  }

  const symbol = input.batch.spec.from.symbol

  const base = (job: SwapBatchJob) => ({
    id: job.walletId,
    label: job.label,
    address: job.address,
    amount: job.amount,
  })

  const commit = (state: SwapWalletState) => {
    progress = withStep(progress, state)
    emit()
  }

  const settle: SettleEntry[] = []

  async function runJob(job: SwapBatchJob): Promise<void> {
    const record = records.get(job.walletId)
    if (!record) return

    let account: PrivateKeyAccount
    try {
      account = privateKeyToAccount(toPrivateKeyHex(record.privateKey))
    } catch (error) {
      commit({
        ...base(job),
        status: 'failed',
        error: toMessage(error),
        tx: null,
      })
      return
    }

    if (account.address.toLowerCase() !== job.address.toLowerCase()) {
      commit({
        ...base(job),
        status: 'failed',
        error: `Stored key signs as ${account.address}, not ${job.address}`,
        tx: null,
      })
      return
    }

    if (job.amount === null) {
      commit({
        ...base(job),
        status: 'failed',
        error: `Balance of ${symbol} could not be read`,
        tx: null,
      })
      return
    }
    if (job.amount === 0n) {
      commit({
        ...base(job),
        status: 'skipped',
        reason: 'Amount is zero',
      })
      return
    }
    if (job.available !== null && job.amount > job.available) {
      commit({
        ...base(job),
        status: 'skipped',
        reason: `Insufficient ${symbol}`,
      })
      return
    }
    if (input.shouldAbort?.()) return

    commit({ ...base(job), status: 'quoting' })

    let quote: SwapQuote
    try {
      quote = await quoteSwap({
        spec: input.batch.spec,
        wallet: job.address,
        amount: job.amount,
      })
    } catch (error) {
      commit({
        ...base(job),
        status: 'failed',
        error: toMessage(error),
        tx: null,
      })
      return
    }

    for (const step of quote.steps) {
      if (step.purpose !== 'approve') continue

      commit({ ...base(job), status: 'signing', step: step.label })

      let sent: Broadcast
      try {
        sent = await broadcastStep({
          wallet: record,
          tx: step.tx,
          shouldAbort: input.shouldAbort,
        })
      } catch (error) {
        if (input.shouldAbort?.()) {
          commit({ ...base(job), status: 'queued' })
        } else {
          commit({
            ...base(job),
            status: 'failed',
            error: toMessage(error),
            tx: null,
          })
        }
        return
      }

      commit({
        ...base(job),
        status: 'confirming',
        step: step.label,
        tx: sent.ref,
      })

      const outcome = await waitForReceiptOutcome(
        step.tx.chain,
        sent.ref.hash,
        {
          from: sent.from,
          nonce: sent.nonce,
          to: step.tx.to,
          input: step.tx.data,
          value: step.tx.value,
        }
      )

      if (outcome.status === 'success') continue
      if (outcome.status === 'reverted') {
        commit({
          ...base(job),
          status: 'failed',
          error: 'Approval reverted',
          tx: sent.ref,
        })
        return
      }

      // Without a confirmed allowance the swap can only revert and burn gas.
      commit({
        ...base(job),
        status: 'unconfirmed',
        tx: sent.ref,
        error: 'Approval is unconfirmed. Check the explorer before retrying.',
      })
      return
    }

    const execute = quote.steps.find((step) => step.purpose === 'execute')
    if (!execute) {
      commit({
        ...base(job),
        status: 'failed',
        error: 'Relay quote has no transaction to send',
        tx: null,
      })
      return
    }

    commit({ ...base(job), status: 'signing', step: execute.label })

    let sent: Broadcast
    try {
      sent = await broadcastStep({
        wallet: record,
        tx: execute.tx,
        shouldAbort: input.shouldAbort,
      })
    } catch (error) {
      if (input.shouldAbort?.()) {
        commit({ ...base(job), status: 'queued' })
      } else {
        commit({
          ...base(job),
          status: 'failed',
          error: toMessage(error),
          tx: null,
        })
      }
      return
    }

    commit({
      ...base(job),
      status: 'confirming',
      step: execute.label,
      tx: sent.ref,
    })

    settle.push({ job, sent, quote, step: execute })
  }

  await mapLimit(input.batch.jobs, WALLET_CONCURRENCY, async (job) => {
    if (input.shouldAbort?.()) return
    await runJob(job)
  })

  // Abort stops future sends only. Every hash the network has seen is awaited.
  await mapLimit(settle, SETTLE_CONCURRENCY, async (entry) => {
    const { job, sent, quote, step } = entry

    const outcome = await waitForReceiptOutcome(
      step.tx.chain,
      sent.ref.hash,
      {
        from: sent.from,
        nonce: sent.nonce,
        to: step.tx.to,
        input: step.tx.data,
        value: step.tx.value,
      }
    )

    if (outcome.status === 'reverted') {
      commit({
        ...base(job),
        status: 'failed',
        error: 'Transaction reverted',
        tx: sent.ref,
      })
      return
    }
    if (outcome.status === 'replaced') {
      commit({
        ...base(job),
        status: 'unconfirmed',
        tx: sent.ref,
        error:
          'This transaction was replaced or dropped. Check the explorer before retrying.',
      })
      return
    }
    if (outcome.status === 'unresolved') {
      commit({
        ...base(job),
        status: 'unconfirmed',
        tx: sent.ref,
        error: 'Still unconfirmed. Check the explorer before retrying.',
      })
      return
    }

    let indexError: string | null = null
    if (step.indexing !== 'none') {
      try {
        await notifyIndexer({
          requestId: quote.requestId,
          indexing: step.indexing,
          chain: sent.ref.chain,
          from: job.address,
          tx: step.tx,
          txHash: sent.ref.hash as `0x${string}`,
        })
      } catch (error) {
        // A relay that cannot index the transaction may still settle it, so
        // keep polling and report the indexing failure on the waiting row.
        indexError = toMessage(error)
      }
    }

    if (!step.awaitsStatus) {
      commit({
        ...base(job),
        status: 'done',
        tx: sent.ref,
        received: quote.amountOut,
      })
      return
    }

    const indexDetail = indexError
      ? `Indexer notification failed: ${indexError}`
      : null

    commit({
      ...base(job),
      status: 'waiting',
      tx: sent.ref,
      detail: indexDetail,
    })

    const status: SwapIntentStatus = await pollSwapIntent({
      requestId: quote.requestId,
      shouldAbort: input.shouldAbort,
    })

    if (status.kind === 'success') {
      commit({
        ...base(job),
        status: 'done',
        tx: sent.ref,
        received: quote.amountOut,
      })
      return
    }
    if (status.kind === 'refund') {
      commit({
        ...base(job),
        status: 'refunded',
        tx: sent.ref,
        reason: status.reason,
      })
      return
    }
    if (status.kind === 'stuck') {
      commit({
        ...base(job),
        status: 'failed',
        error: `Refund will not be automatic: ${status.reason}`,
        tx: sent.ref,
      })
      return
    }
    if (status.kind === 'timeout') {
      const unsettled = 'Relay has not settled this request yet'
      commit({
        ...base(job),
        status: 'waiting',
        tx: sent.ref,
        detail: indexDetail ? `${indexDetail}. ${unsettled}` : unsettled,
      })
    }
    if (status.kind === 'pending') {
      const unwatched = 'Settlement not watched after the run stopped'
      commit({
        ...base(job),
        status: 'waiting',
        tx: sent.ref,
        detail: indexDetail ? `${indexDetail}. ${unwatched}` : unwatched,
      })
    }
  })

  return { progress, error: null }
}

export const SWAP_WALLET_TONE: Record<SwapWalletStatus, string> = {
  queued: 'text-muted-foreground',
  quoting: 'text-muted-foreground',
  signing: 'text-foreground',
  confirming: 'text-foreground',
  waiting: 'text-foreground',
  done: 'text-primary',
  refunded: 'text-warning',
  failed: 'text-destructive',
  unconfirmed: 'text-warning',
  skipped: 'text-muted-foreground',
}

export function swapWalletLabel(state: SwapWalletState): string {
  switch (state.status) {
    case 'queued':
      return 'Queued'
    case 'quoting':
      return 'Quoting'
    case 'signing':
      return `Signing ${state.step}`
    case 'confirming':
      return `Confirming ${state.step}`
    case 'waiting':
      return 'Waiting for Relay'
    case 'done':
      return 'Done'
    case 'refunded':
      return 'Refunded'
    case 'failed':
      return 'Failed'
    case 'unconfirmed':
      return 'Unconfirmed'
    case 'skipped':
      return 'Skipped'
  }
}

export function walletStates(
  progress: SwapRunProgress | null
): Map<string, SwapWalletState> {
  return new Map(
    (progress?.steps ?? []).map((state) => [state.id, state] as const)
  )
}

export function summarizeSwapRun(progress: SwapRunProgress): SwapRunSummary {
  const summary = {
    total: 0,
    active: 0,
    done: 0,
    refunded: 0,
    failed: 0,
    unconfirmed: 0,
    skipped: 0,
    received: 0n,
  }

  for (const state of progress.steps) {
    summary.total += 1
    switch (state.status) {
      case 'queued':
      case 'quoting':
      case 'signing':
      case 'confirming':
      case 'waiting':
        summary.active += 1
        break
      case 'done':
        summary.done += 1
        summary.received += state.received
        break
      case 'refunded':
        summary.refunded += 1
        break
      case 'failed':
        summary.failed += 1
        break
      case 'unconfirmed':
        summary.unconfirmed += 1
        break
      case 'skipped':
        summary.skipped += 1
        break
    }
  }

  return summary
}
