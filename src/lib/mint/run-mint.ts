import { buildMintTransaction } from '@/lib/opensea/index'
import type {
  DropInfo,
  DropStage,
  MintTransaction,
} from '@/lib/opensea/index'
import { cachedEligibilityToken } from '@/lib/opensea/eligibility-token-cache'
import { getEligibilityToken } from '@/lib/opensea/eligibility'
import { callTransaction, estimateGasFor, sendTransaction } from '@/lib/chain/tx'
import type { TxGas } from '@/lib/chain/tx'
import { mintableRow, quantityCeiling } from '@/lib/mint/mint-task'
import type { Task, WalletRun } from '@/lib/mint/mint-task'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type PreparedMintEntry = {
  walletId: string
  from: `0x${string}`
  transaction: MintTransaction
  gasLimit?: bigint
}

export type PreparedMint = {
  key: string
  entries: PreparedMintEntry[]
}

export type MintReadiness = {
  candidates: number
  entries: PreparedMintEntry[]
}

export async function mintForWallet(input: {
  slug: string
  wallet: StoredWallet
  quantity: number
  gas: TxGas
  transaction?: MintTransaction
  shouldAbort?: () => boolean
}): Promise<{ txHash: string; chain: string }> {
  const transaction =
    input.transaction ??
    (await buildMintTransaction(
      input.slug,
      input.wallet.address,
      input.quantity
    ))

  return sendTransaction({
    wallet: input.wallet,
    chainSlug: transaction.chain,
    to: transaction.to as `0x${string}`,
    data: transaction.data as `0x${string}`,
    value: BigInt(transaction.value),
    gas: input.gas,
    shouldAbort: input.shouldAbort,
  })
}

export function mintQuantityFor(
  task: Task,
  walletMax: number,
  stage: DropStage | null
): number | null {
  const ceiling = quantityCeiling(walletMax, stage)
  const requested = Number.parseInt(task.quantity, 10)
  const quantity = ceiling > 0 ? Math.min(requested, ceiling) : requested
  return Number.isFinite(quantity) && quantity >= 1 ? quantity : null
}

// Everything that must match for prepared calldata to still describe this fire. A stage
// or quantity change rebuilds rather than signing stale data.
export function prepareKeyFor(task: Task, quantity: number): string {
  return [
    task.stageUuid,
    quantity,
    task.gasLimit,
    task.maxFee,
    task.priorityFee,
  ].join('|')
}

export function pinnedGasLimitOf(task: Task): bigint | undefined {
  const value = Number.parseInt(task.gasLimit, 10)
  return Number.isFinite(value) && value > 0 ? BigInt(value) : undefined
}

// Live OpenSea answers 409 NOT_MINTING before a stage opens, so the open-time batch is
// the real path. It builds every mintable wallet's calldata in one round trip, then the
// commit reuses those entries instead of fetching again.
export async function mintReadiness(input: {
  task: Task
  drop: DropInfo
  quantity: number
  rows: readonly WalletRun[]
  preparedMint?: PreparedMint
}): Promise<MintReadiness> {
  const { task, drop, quantity } = input
  const mintable = input.rows.filter(
    (row) =>
      task.wallets.includes(row.walletId) && mintableRow(row, task.stageUuid)
  )
  const prepared =
    input.preparedMint?.key === prepareKeyFor(task, quantity)
      ? new Map(
          input.preparedMint.entries.map((entry) => [entry.walletId, entry])
        )
      : null

  const entries = await Promise.all(
    mintable.map(async (row) => {
      const cached = prepared?.get(row.walletId)
      if (cached) return cached
      try {
        const transaction = await buildMintTransaction(
          drop.slug,
          row.address,
          quantity
        )
        return {
          walletId: row.walletId,
          from: row.address as `0x${string}`,
          transaction,
        }
      } catch {
        return null
      }
    })
  )

  return {
    candidates: mintable.length,
    entries: entries.filter(
      (entry): entry is PreparedMintEntry => entry !== null
    ),
  }
}

export async function stageConfirmed(
  chainSlug: string,
  entries: readonly PreparedMintEntry[]
): Promise<boolean> {
  // No calldata means no evidence. The caller retries with backoff instead of treating a
  // failed build as a successful readiness check.
  if (entries.length === 0) return false

  const results = await Promise.allSettled(
    entries.map((entry) =>
      callTransaction({
        chainSlug,
        from: entry.from,
        to: entry.transaction.to as `0x${string}`,
        data: entry.transaction.data as `0x${string}`,
        value: BigInt(entry.transaction.value),
      })
    )
  )
  return results.some((result) => result.status === 'fulfilled')
}

// Builds what it can before the stage opens. `isCurrent` lets the caller stop a batch the
// operator disarmed while it was running.
export async function prepareMintEntries(input: {
  task: Task
  drop: DropInfo
  quantity: number
  wallets: readonly StoredWallet[]
  pinnedGasLimit: bigint | undefined
  isCurrent: () => boolean
}): Promise<PreparedMintEntry[] | null> {
  const entries: PreparedMintEntry[] = []

  for (const wallet of input.wallets) {
    if (!input.isCurrent()) return null

    try {
      await cachedEligibilityToken(wallet.address, () =>
        getEligibilityToken(wallet.privateKey)
      )
    } catch {
      // The check retries a sign-in; a failed warm must not fail prepare.
    }

    try {
      // Measured 2026-11-09: live OpenSea answers 409 NOT_MINTING to this endpoint
      // before a stage opens. This stays best-effort for providers that do answer; the
      // open-time path builds the same calldata when it does not.
      const transaction = await buildMintTransaction(
        input.drop.slug,
        wallet.address,
        input.quantity
      )
      let gasLimit = input.pinnedGasLimit
      if (gasLimit === undefined) {
        try {
          gasLimit = await estimateGasFor({
            wallet,
            chainSlug: transaction.chain,
            to: transaction.to as `0x${string}`,
            data: transaction.data as `0x${string}`,
            value: BigInt(transaction.value),
          })
        } catch {
          // The stage is still closed, so the commit estimates again.
        }
      }
      entries.push({
        walletId: wallet.id,
        from: wallet.address as `0x${string}`,
        transaction,
        gasLimit,
      })
    } catch {
      // Missing calldata falls back to the commit path.
    }
  }

  return entries
}
