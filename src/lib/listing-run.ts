import { privateKeyToAccount } from 'viem/accounts'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/async'
import { submitListingOrder } from '@/lib/opensea'
import { sendTransaction, waitForReceipt } from '@/lib/tx'
import { toPrivateKeyHex } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'
import type {
  ListingPlan,
  PlannedApproval,
  PlannedOrder,
  PlannedWallet,
} from '@/lib/listing-plan'

export type RunStepStatus =
  | 'queued'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'listed'
  | 'failed'

export type RunStepState = {
  id: string
  kind: 'approval' | 'order'
  address: string
  label: string
  tokenKey: string | null
  tokenId: string | null
} & (
  | { status: 'queued' }
  | { status: 'approving' | 'signing' | 'submitting' }
  | { status: 'listed'; orderHash: string | null }
  | { status: 'failed'; error: string }
)

export type ListingRunProgress = {
  steps: readonly RunStepState[]
  startedAt: number
  finishedAt: number | null
}

export type ListingRunOutcome = {
  progress: ListingRunProgress
  error: string | null
}

export type RunSummary = {
  total: number
  listed: number
  failed: number
}

const WALLET_CONCURRENCY = 2

export const RUN_STEP_LABEL: Record<RunStepStatus, string> = {
  queued: 'Queued',
  approving: 'Approving',
  signing: 'Signing',
  submitting: 'Submitting',
  listed: 'Listed',
  failed: 'Failed',
}

export const RUN_STEP_TONE: Record<RunStepStatus, string> = {
  queued: 'text-muted-foreground',
  approving: 'text-foreground',
  signing: 'text-foreground',
  submitting: 'text-foreground',
  listed: 'text-primary',
  failed: 'text-destructive',
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isApproval(step: PlannedApproval | PlannedOrder): step is PlannedApproval {
  return step.kind === 'approval'
}

function isOrder(step: PlannedApproval | PlannedOrder): step is PlannedOrder {
  return step.kind === 'order'
}

export async function runListingPlan(input: {
  plan: ListingPlan
  wallets: readonly StoredWallet[]
  onProgress?: (progress: ListingRunProgress) => void
}): Promise<ListingRunOutcome> {
  const records = new Map(
    input.wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])
  )

  let progress: ListingRunProgress = {
    steps: input.plan.wallets.flatMap((wallet) =>
      wallet.steps.map((step) =>
        step.kind === 'approval'
          ? {
              id: step.id,
              kind: 'approval' as const,
              address: wallet.address,
              label: wallet.label,
              tokenKey: null,
              tokenId: null,
              status: 'queued' as const,
            }
          : {
              id: step.id,
              kind: 'order' as const,
              address: wallet.address,
              label: wallet.label,
              tokenKey: step.tokenKey,
              tokenId: step.token.tokenId,
              status: 'queued' as const,
            }
      )
    ),
    startedAt: Date.now(),
    finishedAt: null,
  }
  input.onProgress?.(progress)

  for (const planned of input.plan.wallets) {
    if (!records.has(planned.address)) {
      return {
        progress,
        error: `No saved wallet matches ${planned.address}`,
      }
    }
  }

  for (const planned of input.plan.wallets) {
    for (const step of planned.steps) {
      const chain = step.kind === 'order' ? step.chain : input.plan.collection.chain
      if (!chainBySlug(chain)) {
        return { progress, error: `Chain not supported: ${chain}` }
      }
    }
  }

  const stateOf = (id: string): RunStepState | null =>
    progress.steps.find((step) => step.id === id) ?? null

  function commit(step: RunStepState) {
    progress = {
      ...progress,
      steps: progress.steps.map((current) =>
        current.id === step.id ? step : current
      ),
    }
    input.onProgress?.(progress)
  }

  async function runWallet(
    planned: PlannedWallet,
    record: StoredWallet
  ): Promise<void> {
    const approvals = planned.steps.filter(isApproval)
    const orders = planned.steps.filter(isOrder)
    const account = privateKeyToAccount(toPrivateKeyHex(record.privateKey))

    for (const approval of approvals) {
      const current = stateOf(approval.id)
      if (!current) continue
      commit({ ...current, status: 'approving' })

      try {
        const sent = await sendTransaction({
          wallet: record,
          chainSlug: input.plan.collection.chain,
          to: approval.to as `0x${string}`,
          data: approval.data as `0x${string}`,
          value: BigInt(approval.value),
        })
        const receipt = await waitForReceipt(
          input.plan.collection.chain,
          sent.txHash
        )
        if (receipt === 'reverted') {
          throw new Error('Transaction reverted')
        }
      } catch (error) {
        const message = failureMessage(error)
        const failedApproval = stateOf(approval.id)
        if (failedApproval) {
          commit({ ...failedApproval, status: 'failed', error: message })
        }

        for (const order of orders) {
          const orderStep = stateOf(order.id)
          if (orderStep) {
            commit({
              ...orderStep,
              status: 'failed',
              error: `Approval failed — ${message}`,
            })
          }
        }
        return
      }

      // An approval has no success state of its own in the status union, so it
      // shares the terminal `listed` state and never carries a hash.
      const approved = stateOf(approval.id)
      if (approved) commit({ ...approved, status: 'listed', orderHash: null })
    }

    for (const order of orders) {
      const signing = stateOf(order.id)
      if (!signing) continue
      commit({ ...signing, status: 'signing' })

      try {
        const signature = await account.signTypedData(order.typedData)

        const submitting = stateOf(order.id)
        if (submitting) commit({ ...submitting, status: 'submitting' })

        const { orderHash } = await submitListingOrder({
          chain: order.chain,
          protocolAddress: order.protocolAddress,
          parameters: order.parameters,
          signature,
        })

        const done = stateOf(order.id)
        if (done) commit({ ...done, status: 'listed', orderHash })
      } catch (error) {
        const currentOrder = stateOf(order.id)
        if (currentOrder) {
          commit({
            ...currentOrder,
            status: 'failed',
            error: failureMessage(error),
          })
        }
      }
    }
  }

  await mapLimit(input.plan.wallets, WALLET_CONCURRENCY, async (planned) => {
    const record = records.get(planned.address)
    if (!record) return
    await runWallet(planned, record)
  })

  progress = { ...progress, finishedAt: Date.now() }
  input.onProgress?.(progress)

  return { progress, error: null }
}

export function tokenStates(
  progress: ListingRunProgress
): Map<string, RunStepState> {
  const states = new Map<string, RunStepState>()

  for (const step of progress.steps) {
    if (step.kind !== 'order' || step.tokenKey === null) continue
    states.set(step.tokenKey, step)
  }

  return states
}

export function listedKeys(progress: ListingRunProgress): string[] {
  return progress.steps.flatMap((step) =>
    step.kind === 'order' && step.status === 'listed' && step.tokenKey !== null
      ? [step.tokenKey]
      : []
  )
}

export function summarizeRun(progress: ListingRunProgress): RunSummary {
  const summary: RunSummary = { total: 0, listed: 0, failed: 0 }

  for (const step of progress.steps) {
    if (step.kind !== 'order') continue
    summary.total += 1
    if (step.status === 'listed') summary.listed += 1
    if (step.status === 'failed') summary.failed += 1
  }

  return summary
}
