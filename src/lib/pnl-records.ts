import { getAll, get, put, remove } from '@/lib/db'
import { formatEth, type PnlStats } from '@/lib/pnl-trades'

// A row is one collection's cumulative PnL at one check, keyed by collection
// and day, so re-checking the same collection that day replaces its numbers
// instead of stacking a second sample. The page derives a day's change by
// subtracting the previous check rather than summing the rows.
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

export function recordId(contract: string, day: string): string {
  return `${contract.toLowerCase()}|${day}`
}

export async function upsertPnlRecord(input: PnlRecordInput): Promise<PnlRecord> {
  const createdAt = input.now ?? Date.now()
  const day = dayKey(new Date(createdAt))
  const wallets = [...new Set(input.wallets.map((wallet) => wallet.toLowerCase()))].sort()
  const record: PnlRecord = {
    id: recordId(input.contract, day),
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
    if (record.createdAt < existing.createdAt) return existing
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

export async function deletePnlRecord(id: string): Promise<void> {
  await remove('pnl-records', id)
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

function walletsOf(record: PnlRecord): string[] {
  return [...new Set(record.wallets.map((wallet) => wallet.toLowerCase()))].sort()
}

function seriesKey(record: PnlRecord): string {
  return `${record.contract.toLowerCase()}|${walletsOf(record).join(',')}`
}

function isEarlier(candidate: PnlRecord, record: PnlRecord): boolean {
  if (candidate.day !== record.day) return candidate.day < record.day
  return candidate.createdAt < record.createdAt
}

// The baseline of a set's first check. Widening a selection leaves wallets that
// were already counted in earlier sets, so every earlier check whose wallets
// this record fully covers supplies their position and only the rest of the PnL
// counts as change. Newest first, and a check that overlaps an accepted one is
// skipped, so each wallet's level is counted once. No covered check means
// nothing was measured before, and the whole position lands on that day.
function baselineWei(record: PnlRecord, snapshots: PnlRecord[]): bigint {
  const wallets = walletsOf(record)
  const covered = snapshots.filter(
    (snapshot) =>
      snapshot.contract.toLowerCase() === record.contract.toLowerCase() &&
      isEarlier(snapshot, record) &&
      walletsOf(snapshot).every((wallet) => wallets.includes(wallet)),
  )
  covered.sort((a, b) => (isEarlier(a, b) ? 1 : isEarlier(b, a) ? -1 : 0))

  const supplied = new Set<string>()
  let baseline = 0n
  for (const snapshot of covered) {
    const set = walletsOf(snapshot)
    if (set.some((wallet) => supplied.has(wallet))) continue
    for (const wallet of set) supplied.add(wallet)
    baseline += netWei(snapshot)
  }

  return baseline
}

// Each snapshot is measured against the previous check of the same collection
// and wallet set. A re-check with another set replaces the day and starts that
// set's series there. Partial reads drop out first, so a day they cover keeps
// the last complete measurement.
export function dailyDeltas(records: PnlRecord[]): DayDelta[] {
  const snapshots = records.filter(isComplete)
  const bySeries = new Map<string, PnlRecord[]>()
  for (const record of snapshots) {
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
    let previous: bigint | null = null
    for (const record of group) {
      const wei = netWei(record)
      const baseline = previous ?? baselineWei(record, snapshots)
      deltas.push({ day: record.day, wei: wei - baseline, ethPriceUsd: record.ethPriceUsd })
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
