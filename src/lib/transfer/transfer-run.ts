import { privateKeyToAccount } from 'viem/accounts'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/core/async'
import { toMessage } from '@/lib/core/error-message'
import { SETTLE_CONCURRENCY, WALLET_CONCURRENCY } from '@/lib/core/concurrency'
import { addressKey, sameAddress } from '@/lib/wallet/address'
import { stepById, withStep } from '@/lib/core/run-progress'
import type { RunOutcome, RunProgress } from '@/lib/core/run-engine'
import {
  BroadcastError,
  sendTransaction,
  waitForReceiptOutcome,
} from '@/lib/chain/tx'
import type {
  TransferPlan,
  PlannedTransferWallet,
} from '@/lib/transfer/transfer-plan'
import { toPrivateKeyHex } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type TransferStepStatus =
  | 'queued'
  | 'signing'
  | 'confirming'
  | 'sent'
  | 'unknown'
  | 'failed'

export type TransferStepState = {
  id: string
  tokenKey: string
  chain: string
  contract: string
  tokenId: string
  amount: number
  from: string
  label: string
} & (
  | { status: 'queued' }
  | { status: 'signing' }
  | { status: 'confirming'; txHash: string }
  | { status: 'sent'; txHash: string }
  | { status: 'unknown'; txHash: string; error: string }
  | { status: 'failed'; error: string; txHash: string | null }
)

export type TransferRunProgress = RunProgress<TransferStepState>

export type TransferRunSummary = {
  total: number
  sent: number
  unknown: number
  failed: number
}

export const TRANSFER_STEP_LABEL: Record<TransferStepStatus, string> = {
  queued: 'Queued',
  signing: 'Signing',
  confirming: 'Confirming',
  sent: 'Sent',
  unknown: 'Unconfirmed',
  failed: 'Failed',
}

export const TRANSFER_STEP_TONE: Record<TransferStepStatus, string> = {
  queued: 'text-muted-foreground',
  signing: 'text-foreground',
  confirming: 'text-foreground',
  sent: 'text-primary',
  unknown: 'text-warning',
  failed: 'text-destructive',
}

export async function runTransferPlan(input: {
  plan: TransferPlan
  wallets: readonly StoredWallet[]
  onProgress?: (progress: TransferRunProgress) => void
  shouldAbort?: () => boolean
}): Promise<RunOutcome<TransferRunProgress>> {
  const records = new Map(
    input.wallets.map((wallet) => [addressKey(wallet.address), wallet])
  )

  let progress: TransferRunProgress = {
    steps: input.plan.wallets.flatMap((wallet) =>
      wallet.transfers.map((transfer) => ({
        id: transfer.id,
        tokenKey: transfer.tokenKey,
        chain: transfer.chain,
        contract: transfer.contract,
        tokenId: transfer.tokenId,
        amount: transfer.amount,
        from: transfer.from,
        label: wallet.label,
        status: 'queued' as const,
      }))
    ),
  }
  input.onProgress?.(progress)

  for (const wallet of input.plan.wallets) {
    if (!records.has(addressKey(wallet.address))) {
      return { progress, error: `No saved wallet matches ${wallet.address}` }
    }
  }

  if (!chainBySlug(input.plan.chain)) {
    return { progress, error: `Chain not supported: ${input.plan.chain}` }
  }

  function commit(step: TransferStepState) {
    progress = withStep(progress, step)
    input.onProgress?.(progress)
  }

  function failWallet(planned: PlannedTransferWallet, message: string) {
    for (const transfer of planned.transfers) {
      const current = stepById(progress, transfer.id)
      if (current) {
        commit({ ...current, status: 'failed', error: message, txHash: null })
      }
    }
  }

  async function runWallet(planned: PlannedTransferWallet): Promise<void> {
    const record = records.get(addressKey(planned.address))
    if (!record) return

    let account: ReturnType<typeof privateKeyToAccount>
    try {
      account = privateKeyToAccount(toPrivateKeyHex(record.privateKey))
    } catch (error) {
      failWallet(planned, toMessage(error))
      return
    }

    // The key signs as its own account. A transfer sent from an address the key
    // does not control reverts on chain after gas is spent.
    if (!sameAddress(account.address, planned.address)) {
      failWallet(
        planned,
        `Stored key signs as ${account.address}, not ${planned.address}`
      )
      return
    }

    const broadcast: {
      id: string
      txHash: string
      from: `0x${string}`
      nonce: number
      to: `0x${string}`
      data: `0x${string}`
    }[] = []

    for (const transfer of planned.transfers) {
      if (input.shouldAbort?.()) break

      const signing = stepById(progress, transfer.id)
      if (!signing) continue
      commit({ ...signing, status: 'signing' })

      try {
        // `sendTransaction` already serializes nonces per sender, so the plan's
        // order is the only queue this loop needs.
        const sent = await sendTransaction({
          wallet: record,
          chainSlug: input.plan.chain,
          to: transfer.contract,
          data: transfer.data,
          value: 0n,
          shouldAbort: input.shouldAbort,
        })
        broadcast.push({
          id: transfer.id,
          txHash: sent.txHash,
          from: sent.from,
          nonce: sent.nonce,
          to: transfer.contract,
          data: transfer.data,
        })

        const confirming = stepById(progress, transfer.id)
        if (confirming) {
          commit({ ...confirming, status: 'confirming', txHash: sent.txHash })
        }
      } catch (error) {
        if (error instanceof BroadcastError) {
          broadcast.push({
            id: transfer.id,
            txHash: error.txHash,
            from: error.from,
            nonce: error.nonce,
            to: transfer.contract,
            data: transfer.data,
          })
          const confirming = stepById(progress, transfer.id)
          if (confirming) {
            commit({ ...confirming, status: 'confirming', txHash: error.txHash })
          }
          continue
        }

        const current = stepById(progress, transfer.id)
        // The abort check inside `sendTransaction` runs before broadcast, so a
        // row stopped there never left the queue.
        if (input.shouldAbort?.()) {
          if (current) commit({ ...current, status: 'queued' })
          break
        }
        if (current) {
          commit({
            ...current,
            status: 'failed',
            error: toMessage(error),
            txHash: null,
          })
        }
      }
    }

    // Every hash already broadcast is awaited to its receipt: the run aborts
    // future sends, never a transaction the network has seen.
    await mapLimit(broadcast, SETTLE_CONCURRENCY, async (pending) => {
      const current = stepById(progress, pending.id)
      if (!current || current.status !== 'confirming') return

      const outcome = await waitForReceiptOutcome(
        input.plan.chain,
        pending.txHash,
        {
          from: pending.from,
          nonce: pending.nonce,
          to: pending.to,
          input: pending.data,
          value: 0n,
        }
      )

      if (outcome.status === 'success') {
        commit({ ...current, status: 'sent', txHash: outcome.txHash })
        return
      }

      if (outcome.status === 'reverted') {
        commit({
          ...current,
          status: 'failed',
          error: 'Transaction reverted',
          txHash: outcome.txHash,
        })
        return
      }

      if (outcome.status === 'replaced') {
        commit({
          ...current,
          status: 'unknown',
          txHash: pending.txHash,
          error:
            'This transaction was replaced or dropped. Check the destination before retrying.',
        })
        return
      }

      commit({
        ...current,
        status: 'unknown',
        txHash: pending.txHash,
        error: 'Still unconfirmed. Check the explorer before retrying.',
      })
    })
  }

  await mapLimit(input.plan.wallets, WALLET_CONCURRENCY, async (planned) => {
    if (input.shouldAbort?.()) return
    await runWallet(planned)
  })

  return { progress, error: null }
}

export function tokenStates(
  progress: TransferRunProgress
): Map<string, TransferStepState> {
  return new Map(
    progress.steps.map((step) => [step.tokenKey, step] as const)
  )
}

export function spentUnits(
  progress: TransferRunProgress
): Map<string, number> {
  const units = new Map<string, number>()

  for (const step of progress.steps) {
    if (step.status !== 'sent' && step.status !== 'unknown') continue
    units.set(step.tokenKey, step.amount)
  }

  return units
}

export function summarizeTransferRun(
  progress: TransferRunProgress
): TransferRunSummary {
  const summary: TransferRunSummary = {
    total: 0,
    sent: 0,
    unknown: 0,
    failed: 0,
  }

  for (const step of progress.steps) {
    summary.total += 1
    if (step.status === 'sent') summary.sent += 1
    if (step.status === 'unknown') summary.unknown += 1
    if (step.status === 'failed') summary.failed += 1
  }

  return summary
}
