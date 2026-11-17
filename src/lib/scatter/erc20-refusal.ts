import { ScatterError } from '@/lib/scatter/error'

// The code the client throws when a build names an ERC-20 requirement Velox cannot
// resolve, so the run can tell a list the operator must fix apart from a request that
// errored.
export const ERC20_REFUSAL_CODE = 'erc20-list'

// A build that names an allowance Velox cannot parse must fail closed: reading it as
// native would sign a mint the wallet is not funded for.
export function unreadableAllowanceRefusal(): string {
  return 'Scatter answered with an ERC-20 allowance Velox cannot resolve, so nothing was signed. Check the token address and amount.'
}

// The spender is the collection, pinned by the recorded build. Without a collection
// address there is no safe allowance target, so the build is refused rather than guessed.
export function unresolvedSpenderRefusal(): string {
  return 'Scatter answered with an ERC-20 allowance whose spender Velox cannot resolve, so nothing was signed. Check the collection address.'
}

export function isErc20Refusal(error: unknown): boolean {
  return error instanceof ScatterError && error.code === ERC20_REFUSAL_CODE
}
