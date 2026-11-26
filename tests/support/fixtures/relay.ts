/**
 * One `POST /quote/v2` body. The app requires exactly one executable step, with
 * a `deposit` or `swap` id. An `approve` option adds the approval step ahead of
 * that executable one.
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
  stepId?: 'deposit' | 'swap'
  /** Whether the executable step carries a `check` block; `awaitsStatus` reads it. */
  check?: boolean
  /** `details.totalImpact.percent`, omitted when absent. */
  totalImpactPercent?: string | null
  /** The `fees.relayer` entry, omitted when absent. */
  relayFee?: {
    amount: string
    symbol?: string
    decimals?: number
  } | null
  /** An approval step to send before the executable one. */
  approve?: {
    to: string
    data: string
    value?: string
    chainId?: number
  } | null
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
    totalImpactPercent = null,
    relayFee = null,
    approve = null,
  } = options

  const steps = [
    ...(approve
      ? [
          {
            kind: 'transaction',
            id: 'approve',
            items: [
              {
                data: {
                  to: approve.to,
                  data: approve.data,
                  value: approve.value ?? '0',
                  chainId: approve.chainId ?? chainId,
                },
                check: {},
              },
            ],
          },
        ]
      : []),
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
  ]

  return {
    requestId,
    details: {
      operation,
      currencyOut: { amount: amountOut, minimumAmount },
      ...(totalImpactPercent === null
        ? {}
        : { totalImpact: { percent: totalImpactPercent } }),
    },
    ...(relayFee === null
      ? {}
      : {
          fees: {
            relayer: {
              amount: relayFee.amount,
              currency: {
                symbol: relayFee.symbol ?? 'ETH',
                decimals: relayFee.decimals ?? 18,
              },
            },
          },
        }),
    steps,
  }
}
