import { privateKeyToAccount } from 'viem/accounts'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/core/async'
import { toMessage } from '@/lib/core/error-message'
import { submitListingOrder } from '@/lib/opensea/index'
import { stepById, withStep } from '@/lib/core/run-progress'
import { WALLET_CONCURRENCY, sendTransaction, waitForReceipt } from '@/lib/chain/tx'
import { toPrivateKeyHex } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'
import type {
  ListingPlan,
  PlannedApproval,
  PlannedOrder,
  PlannedWallet,
} from '@/lib/listings/listing-plan'

export type RunStepStatus =
  | 'queued'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'approved'
  | 'listed'
  | 'failed'

export type RunStepState = {
  id: string
  address: string
  label: string
  tokenKey: string | null
  tokenId: string | null
} & (
  | { kind: 'approval'; status: 'queued' | 'approving' | 'approved' }
  | { kind: 'approval'; status: 'failed'; error: string }
  | { kind: 'order'; status: 'queued' | 'signing' | 'submitting' }
  | { kind: 'order'; status: 'listed'; orderHash: string | null }
  | { kind: 'order'; status: 'failed'; error: string }
)

export type ListingRunProgress = {
  steps: readonly RunStepState[]
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

export const RUN_STEP_LABEL: Record<RunStepStatus, string> = {
  queued: 'Queued',
  approving: 'Approving',
  approved: 'Approved',
  signing: 'Signing',
  submitting: 'Submitting',
  listed: 'Listed',
  failed: 'Failed',
}

export const RUN_STEP_TONE: Record<RunStepStatus, string> = {
  queued: 'text-muted-foreground',
  approving: 'text-foreground',
  approved: 'text-primary',
  signing: 'text-foreground',
  submitting: 'text-foreground',
  listed: 'text-primary',
  failed: 'text-destructive',
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
  shouldAbort?: () => boolean
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

  function commit(step: RunStepState) {
    progress = withStep(progress, step)
    input.onProgress?.(progress)
  }

  function failStep(step: RunStepState, error: string): RunStepState {
    return { ...step, status: 'failed', error }
  }

  async function runWallet(
    planned: PlannedWallet,
    record: StoredWallet
  ): Promise<void> {
    const approvals = planned.steps.filter(isApproval)
    const orders = planned.steps.filter(isOrder)

    let account: ReturnType<typeof privateKeyToAccount>
    try {
      account = privateKeyToAccount(toPrivateKeyHex(record.privateKey))
    } catch (error) {
      // A stored key that no longer parses fails this wallet, not the whole run.
      const message = toMessage(error)
      for (const step of planned.steps) {
        const current = stepById(progress, step.id)
        if (current) commit(failStep(current, message))
      }
      return
    }

    // The key signs as its own account. A stored address that drifted from the
    // key would submit orders OpenSea rejects as an invalid signature after the
    // approval has already been paid for.
    if (account.address.toLowerCase() !== planned.address) {
      const message = `Stored key signs as ${account.address}, not ${planned.address}`
      for (const step of planned.steps) {
        const current = stepById(progress, step.id)
        if (current) commit(failStep(current, message))
      }
      return
    }

    for (const approval of approvals) {
      if (input.shouldAbort?.()) return

      const current = stepById(progress, approval.id)
      if (!current || current.kind !== 'approval') continue
      commit({ ...current, status: 'approving' })

      try {
        const sent = await sendTransaction({
          wallet: record,
          chainSlug: input.plan.collection.chain,
          to: approval.to,
          data: approval.data,
          value: BigInt(approval.value),
          shouldAbort: input.shouldAbort,
        })
        const receipt = await waitForReceipt(
          input.plan.collection.chain,
          sent.txHash
        )
        if (receipt === 'reverted') {
          throw new Error('Transaction reverted')
        }
      } catch (error) {
        const message = toMessage(error)
        const failedApproval = stepById(progress, approval.id)
        if (failedApproval) {
          commit(failStep(failedApproval, message))
        }

        for (const order of orders) {
          const orderStep = stepById(progress, order.id)
          if (orderStep) {
            commit(failStep(orderStep, `Approval failed — ${message}`))
          }
        }
        return
      }

      // The approval is done; its orders still have to be signed.
      const approved = stepById(progress, approval.id)
      if (approved?.kind === 'approval') {
        commit({ ...approved, status: 'approved' })
      }
    }

    for (const order of orders) {
      if (input.shouldAbort?.()) return

      const signing = stepById(progress, order.id)
      if (!signing || signing.kind !== 'order') continue
      commit({ ...signing, status: 'signing' })

      try {
        const signature = await account.signTypedData(order.typedData)

        if (input.shouldAbort?.()) return

        const submitting = stepById(progress, order.id)
        if (submitting?.kind === 'order') {
          commit({ ...submitting, status: 'submitting' })
        }

        const { orderHash } = await submitListingOrder({
          chain: order.chain,
          protocolAddress: order.protocolAddress,
          parameters: order.parameters,
          signature,
        })

        const done = stepById(progress, order.id)
        if (done?.kind === 'order') {
          commit({ ...done, status: 'listed', orderHash })
        }
      } catch (error) {
        const currentOrder = stepById(progress, order.id)
        if (currentOrder) {
          commit(failStep(currentOrder, toMessage(error)))
        }
      }
    }
  }

  await mapLimit(input.plan.wallets, WALLET_CONCURRENCY, async (planned) => {
    if (input.shouldAbort?.()) return
    const record = records.get(planned.address)
    if (!record) return
    await runWallet(planned, record)
  })

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
