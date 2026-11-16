import { amountLabel } from '@/lib/mint/amount'
import type { DropStage } from '@/lib/opensea/index'
import { ScatterError } from '@/lib/scatter/error'

// Scatter's docs describe granting a token allowance before the mint. Velox never grants
// one, so a list priced in an ERC-20 is refused instead, and the message says where the
// operator can mint it.
const NATIVE_ONLY =
  'Velox mints native-currency lists only — mint this list on Scatter itself.'

// The code the client throws when a build asks for an ERC-20 allowance, so the run can
// tell a list the operator must fix apart from a request that errored.
export const ERC20_REFUSAL_CODE = 'erc20-list'

export type ScatterAllowance = { address: string; amount: string }

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// The refusal a build reaches from the allowances it answered with, before any
// transaction is signed or sent.
export function erc20RefusalForAllowances(
  allowances: readonly ScatterAllowance[],
  stage: DropStage | null = null
): string {
  const named = allowances
    .map((entry) => {
      const currency = stage?.currency
      if (currency && currency.address.toLowerCase() === entry.address.toLowerCase()) {
        return `${amountLabel(BigInt(entry.amount), stage)} (${shortAddress(entry.address)})`
      }
      return `${entry.amount} base units of ${shortAddress(entry.address)}`
    })
    .join(', ')
  return `This Scatter list needs an ERC-20 allowance for ${named}. ${NATIVE_ONLY}`
}

// The refusal exists to stop a token-priced mint, so an allowance list whose shape cannot
// be read must refuse as well. Reading it as empty would let the mint through.
export function unreadableAllowanceRefusal(): string {
  return `Scatter answered with an allowance list Velox cannot read, so nothing was signed. ${NATIVE_ONLY}`
}

export function isErc20Refusal(error: unknown): boolean {
  return error instanceof ScatterError && error.code === ERC20_REFUSAL_CODE
}
