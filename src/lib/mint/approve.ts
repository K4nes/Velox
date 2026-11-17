import {
  approveToken,
  readTokenAllowance,
  readTokenBalance,
} from '@/lib/chain/erc20'
import { BroadcastError, clientFor, waitForReceipt } from '@/lib/chain/tx'
import type { TxGas } from '@/lib/chain/tx'
import { toMessage } from '@/lib/core/message'
import { allowanceAmountLabel } from '@/lib/mint/allowance'
import type { MintAllowance } from '@/lib/mint/allowance'
import type { StoredWallet } from '@/lib/wallet/wallets'

// The two things that can stop a wallet before its mint is sent. Naming the stage is
// what lets the log say which transaction failed instead of only that one did.
export type ApprovalStage = 'balance' | 'approval'

export type ApprovalRun =
  | { kind: 'ready'; log: string[] }
  | { kind: 'failed'; stage: ApprovalStage; error: string; log: string[] }
  | { kind: 'aborted'; log: string[] }

// A token is named for the operator when its display metadata resolved, and by address
// when it did not. The amount always reads from the same rule the check used.
function approvalLine(allowance: MintAllowance, txHash: string): string {
  return `Approval ${txHash} for ${allowanceAmountLabel(allowance, allowance.amount)} to ${allowance.spender}.`
}

// Reads the balance and the allowance again, because a check's answer can be stale by
// the time the list opens. A short balance fails before anything is signed. A covering
// allowance sends nothing. Every other allowance is granted for its exact base-unit
// amount and confirmed before the next one, so a wallet's approvals and its mint stay in
// order. A native list reaches the first line and pays no read.
export async function runApprovals(input: {
  wallet: StoredWallet
  chainSlug: string
  allowances: readonly MintAllowance[]
  gas: TxGas
  shouldAbort: () => boolean
  onApproving: () => void
}): Promise<ApprovalRun> {
  if (input.allowances.length === 0) return { kind: 'ready', log: [] }

  const log: string[] = []
  let client
  try {
    client = await clientFor(input.chainSlug)
  } catch (error) {
    return { kind: 'failed', stage: 'balance', error: toMessage(error), log }
  }

  for (const allowance of input.allowances) {
    if (input.shouldAbort()) return { kind: 'aborted', log }

    let balance: bigint
    let approved: bigint
    try {
      balance = await readTokenBalance({
        client,
        token: allowance.token,
        owner: input.wallet.address as `0x${string}`,
      })
      approved = await readTokenAllowance({
        client,
        token: allowance.token,
        owner: input.wallet.address as `0x${string}`,
        spender: allowance.spender,
      })
    } catch (error) {
      return { kind: 'failed', stage: 'balance', error: toMessage(error), log }
    }

    if (balance < allowance.amount) {
      const short = allowanceAmountLabel(allowance, allowance.amount - balance)
      return {
        kind: 'failed',
        stage: 'balance',
        error: `The wallet is short by ${short}.`,
        log,
      }
    }
    if (approved >= allowance.amount) continue

    input.onApproving()
    let txHash: string
    let chain: string
    try {
      const sent = await approveToken({
        wallet: input.wallet,
        chainSlug: input.chainSlug,
        token: allowance.token,
        spender: allowance.spender,
        amount: allowance.amount,
        gas: input.gas,
        shouldAbort: input.shouldAbort,
      })
      txHash = sent.txHash
      chain = sent.chain
    } catch (error) {
      // A broadcast that may have reached the node carries its hash, and the log keeps
      // it so the operator can find the transaction the run cannot confirm.
      if (error instanceof BroadcastError) {
        log.push(`Approval ${error.txHash} for ${allowance.token}.`)
      }
      return { kind: 'failed', stage: 'approval', error: toMessage(error), log }
    }

    log.push(approvalLine(allowance, txHash))

    let status: 'success' | 'reverted'
    try {
      status = await waitForReceipt(chain, txHash)
    } catch (error) {
      return {
        kind: 'failed',
        stage: 'approval',
        error: toMessage(error),
        log,
      }
    }
    if (status === 'reverted') {
      return {
        kind: 'failed',
        stage: 'approval',
        error: 'The approval transaction reverted.',
        log,
      }
    }

    // A stop that arrives while the approval confirms leaves the approval in place and
    // says so; the mint behind it is never signed.
    if (input.shouldAbort()) return { kind: 'aborted', log }
  }

  return { kind: 'ready', log }
}
