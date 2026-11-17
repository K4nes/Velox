import { formatUnits } from 'viem'

// A list priced in an ERC-20 asks the wallet for two things: enough of the token and
// enough allowance for the spender to move it. Both are carried in base units; the
// symbol and decimals are display metadata the provider may not have stated.
export type MintAllowance = {
  token: `0x${string}`
  amount: bigint
  spender: `0x${string}`
  symbol?: string
  decimals?: number
}

// An amount reads as the token only when the provider stated both the symbol and the
// decimals. Anything less names the base units and the full token address instead of
// guessing an 18-decimal ETH reading.
export function allowanceAmountLabel(
  allowance: MintAllowance,
  value: bigint
): string {
  if (allowance.symbol !== undefined && allowance.decimals !== undefined) {
    return `${formatUnits(value, allowance.decimals)} ${allowance.symbol}`
  }
  return `${value} base units of ${allowance.token}`
}

// The log line the row carries: what the token wanted, who moves it, and what the
// wallet holds and has granted. The wording stays stable because e2e tests assert
// these words, and the operator reads the same line the verdict was taken from.
export function allowanceLog(
  reads: readonly {
    allowance: MintAllowance
    balance: bigint
    approved: bigint
  }[],
  verdict: 'needs-approval' | 'blocked'
): string {
  const lines = reads.map(({ allowance, balance, approved }) => {
    return [
      `Allowance ${allowanceAmountLabel(allowance, allowance.amount)} (${allowance.amount} base units).`,
      `Token ${allowance.token}; ${
        allowance.symbol !== undefined && allowance.decimals !== undefined
          ? `symbol ${allowance.symbol}, decimals ${allowance.decimals}`
          : 'symbol and decimals unresolved'
      }.`,
      `Spender ${allowance.spender}.`,
      `Wallet balance ${balance} base units; wallet allowance ${approved} base units.`,
    ].join(' ')
  })

  if (verdict === 'needs-approval') {
    const short = reads.filter((read) => read.approved < read.allowance.amount)
    const shortBy = short
      .map((read) =>
        allowanceAmountLabel(read.allowance, read.allowance.amount - read.approved)
      )
      .join(', ')
    lines.push('Approval is required before this wallet can mint.')
    lines.push(`The allowance is short by ${shortBy}.`)
  } else {
    const short = reads.filter((read) => read.balance < read.allowance.amount)
    const shortBy = short
      .map((read) =>
        allowanceAmountLabel(read.allowance, read.allowance.amount - read.balance)
      )
      .join(', ')
    lines.push(`The balance is short by ${shortBy}.`)
  }

  return lines.join('\n')
}
