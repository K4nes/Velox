import { getAll, get, put } from '@/lib/db'
import { formatEth, type PnlStats } from '@/lib/pnl-trades'

// Re-checking the same collection, wallet set and day rewrites that row instead
// of stacking a second sample. Every row holds the collection's cumulative PnL
// at that check, so the page derives a day's change by subtracting the previous
// check rather than summing the rows.
export type PnlRecord = {
  id: string
  createdAt: number
  day: string
  slug: string
  name: string
  imageUrl: string
  chain: string
  contract: string
  wallets: string[]
  netPnl: string
  ethPriceUsd: number | null
  truncated: boolean
  unpriced: boolean
}

export type PnlRecordInput = {
  slug: string
  name: string
  imageUrl: string
  chain: string
  contract: string
  wallets: string[]
  stats: PnlStats
  ethPriceUsd: number | null
  truncated: boolean
  unpriced: boolean
  now?: number
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function recordId(contract: string, wallets: string[], day: string): string {
  const addresses = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))].sort()
  return `${contract.toLowerCase()}|${addresses.join(',')}|${day}`
}

export async function upsertPnlRecord(input: PnlRecordInput): Promise<PnlRecord> {
  const createdAt = input.now ?? Date.now()
  const day = dayKey(new Date(createdAt))
  const wallets = [...new Set(input.wallets.map((wallet) => wallet.toLowerCase()))].sort()
  const record: PnlRecord = {
    id: recordId(input.contract, wallets, day),
    createdAt,
    day,
    slug: input.slug,
    name: input.name,
    imageUrl: input.imageUrl,
    chain: input.chain,
    contract: input.contract,
    wallets,
    netPnl: (input.stats.realized + input.stats.unrealized).toString(),
    ethPriceUsd: input.ethPriceUsd,
    truncated: input.truncated,
    unpriced: input.unpriced,
  }

  // The same check replayed through a remount must not swap a stored quote for
  // a newer one, and a partial re-read must not replace the day's complete
  // measurement with an incomplete one.
  const existing = await get<PnlRecord>('pnl-records', record.id)
  if (existing !== undefined) {
    if (!isComplete(record) && isComplete(existing)) return existing
    if (
      existing.createdAt === record.createdAt &&
      existing.ethPriceUsd !== null &&
      record.ethPriceUsd !== null
    ) {
      return existing
    }
  }

  await put<PnlRecord>('pnl-records', record)
  return record
}

export async function listPnlRecords(): Promise<PnlRecord[]> {
  const records = await getAll<PnlRecord>('pnl-records')
  return [...records].sort((a, b) => b.createdAt - a.createdAt)
}

export function netWei(record: PnlRecord): bigint {
  return BigInt(record.netPnl)
}

export function netEth(record: PnlRecord): number {
  return Number(netWei(record)) / 10 ** 18
}

export function recordUsd(record: PnlRecord): string {
  if (record.ethPriceUsd === null) return '—'
  return usd.format(netEth(record) * record.ethPriceUsd)
}

export function monthPrefix(month: Date): string {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
}

export function recordsInMonth(records: PnlRecord[], month: Date): PnlRecord[] {
  const prefix = monthPrefix(month)
  return records.filter((record) => record.day.startsWith(`${prefix}-`))
}

// A truncated or unpriced read measured part of the position, so it is not a
// snapshot anything can be compared against. It stays visible in the table and
// out of the totals.
export function isComplete(record: PnlRecord): boolean {
  return !record.truncated && !record.unpriced
}

type DayDelta = { day: string; wei: bigint; ethPriceUsd: number | null }

function seriesKey(record: PnlRecord): string {
  return `${record.contract.toLowerCase()}|${[...record.wallets].sort().join(',')}`
}

// The newest complete check of a collection and wallet set wins its day, then
// each snapshot is measured against the previous check of that same set. Sets
// stay separate, like the ids do, so a check of wallet B is not folded into the
// series of wallet A. A set's first check counts in full, since nothing before
// it says how much of that PnL predates storage. Partial reads drop out first,
// so a day they cover keeps the last complete measurement.
export function dailyDeltas(records: PnlRecord[]): DayDelta[] {
  const latest = new Map<string, PnlRecord>()

  for (const record of records) {
    if (!isComplete(record)) continue
    const key = `${seriesKey(record)}|${record.day}`
    const current = latest.get(key)
    if (current === undefined || record.createdAt > current.createdAt) {
      latest.set(key, record)
    }
  }

  const bySeries = new Map<string, PnlRecord[]>()
  for (const record of latest.values()) {
    const key = seriesKey(record)
    const group = bySeries.get(key)
    if (group === undefined) {
      bySeries.set(key, [record])
    } else {
      group.push(record)
    }
  }

  const deltas: DayDelta[] = []
  for (const group of bySeries.values()) {
    group.sort((a, b) => a.day.localeCompare(b.day))
    let previous = 0n
    for (const record of group) {
      const wei = netWei(record)
      deltas.push({ day: record.day, wei: wei - previous, ethPriceUsd: record.ethPriceUsd })
      previous = wei
    }
  }

  return deltas
}

// Every day of the month is present, so the area keeps a flat zero on days
// without a check instead of stretching the neighbours across the gap.
export function dailyNetSeries(
  records: PnlRecord[],
  month: Date,
): { day: number; net: number }[] {
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const totals = new Array<number>(length).fill(0)
  const prefix = monthPrefix(month)

  for (const delta of dailyDeltas(records)) {
    if (!delta.day.startsWith(`${prefix}-`)) continue
    const index = Number(delta.day.slice(8, 10)) - 1
    if (index >= 0 && index < length) {
      totals[index] += Number(delta.wei) / 10 ** 18
    }
  }

  return totals.map((net, index) => ({ day: index + 1, net }))
}

export function monthNet(records: PnlRecord[], month: Date): { wei: bigint; usd: string } {
  const prefix = monthPrefix(month)
  const deltas = dailyDeltas(records).filter((delta) =>
    delta.day.startsWith(`${prefix}-`),
  )

  let wei = 0n
  let usdTotal = 0
  let priced = 0

  for (const delta of deltas) {
    wei += delta.wei
    if (delta.ethPriceUsd !== null) {
      usdTotal += (Number(delta.wei) / 10 ** 18) * delta.ethPriceUsd
      priced += 1
    }
  }

  // Checks run at different times carry different quotes, so each day's change
  // is converted at the quote of the check that measured it. A check saved
  // without a price makes the month figure incomplete, not zero.
  const value =
    deltas.length > 0 && priced === deltas.length ? usd.format(usdTotal) : '—'

  return { wei, usd: value }
}

export function formatNetPnl(record: PnlRecord): string {
  return `${formatEth(netWei(record))} ETH`
}
