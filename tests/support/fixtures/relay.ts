/**
 * One `POST /quote/v2` body. The app requires exactly one executable step, so
 * the step id must be `deposit`, `swap` or `approve`.
 */
export type RelayQuoteOptions = {
  requestId?: string
  operation?: 'wrap' | 'unwrap' | 'swap'
  amountOut?: string
  minimumAmount?: string
  chainId?: number
  to?: string
  data?: string
  value?: string
  stepId?: 'deposit' | 'swap' | 'approve'
  /** Whether the step carries a `check` block; `awaitsStatus` reads it. */
  check?: boolean
}

const STEP_ADDRESS = `0x${'ab'.repeat(20)}`

export function relayQuoteFixture(options: RelayQuoteOptions = {}) {
  const {
    requestId = 'e2e-relay-quote',
    operation = 'wrap',
    amountOut = '100000000000000000',
    minimumAmount = '99000000000000000',
    chainId = 1,
    to = STEP_ADDRESS,
    data = '0x1234',
    value = '0',
    stepId = 'deposit',
    check = true,
  } = options

  return {
    requestId,
    details: {
      operation,
      currencyOut: { amount: amountOut, minimumAmount },
    },
    steps: [
      {
        kind: 'transaction',
        id: stepId,
        items: [
          {
            data: { to, data, value, chainId },
            ...(check ? { check: {} } : {}),
          },
        ],
      },
    ],
  }
}
