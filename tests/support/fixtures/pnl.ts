import type { SeedPnlRecord } from '../seed'

/** The row key's day: local date, as the monthly view computes it. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export type PnlRecordFixtureOptions = {
  contract?: string
  /** Defaults to the local day of `createdAt`, which the monthly view shows. */
  day?: string
  slug?: string
  name?: string
  chain?: string
  wallets?: string[]
  netPnl?: string
  ethPriceUsd?: number | null
  truncated?: boolean
  unpriced?: boolean
  createdAt?: number
  realized?: string
  spent?: string
  basis?: string
  held?: number
  sold?: number
}

/**
 * One `pnl-records` row with the `v: 2` breakdown. The default is 1 ETH net at
 * $3,000, so the monthly and lifetime pages have a figure to render.
 */
export function pnlRecordFixture(
  options: PnlRecordFixtureOptions = {},
): SeedPnlRecord {
  const contract = options.contract ?? `0x${'aa'.repeat(20)}`
  const createdAt = options.createdAt ?? Date.now()
  const day = options.day ?? dayKey(new Date(createdAt))
  const netPnl = options.netPnl ?? '1000000000000000000'

  return {
    id: `${contract.toLowerCase()}|${day}`,
    createdAt,
    day,
    slug: options.slug ?? 'mock-collection',
    name: options.name ?? 'Mock Collection',
    imageUrl: '',
    chain: options.chain ?? 'robinhood',
    contract,
    wallets: options.wallets ?? [],
    netPnl,
    ethPriceUsd:
      options.ethPriceUsd === undefined ? 3000 : options.ethPriceUsd,
    truncated: options.truncated ?? false,
    unpriced: options.unpriced ?? false,
    breakdown: {
      v: 2,
      realized: options.realized ?? netPnl,
      spent: options.spent ?? '0',
      basis: options.basis ?? '0',
      held: options.held ?? 0,
      sold: options.sold ?? 0,
    },
  }
}
