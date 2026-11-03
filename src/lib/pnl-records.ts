import { getAll, get, put, remove } from '@/lib/db'
import { formatEth, type PnlStats } from '@/lib/pnl-trades'

export type PnlBreakdown = {
  realized: string
  invested: string
  held: number
  sold: number
}

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
  // Rows saved before the split existed have no breakdown; their net still
  // counts, but no realized or invested figure can be recovered from it.
  breakdown?: PnlBreakdown
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

export function formatUsd(value: number | null): string {
  if (value === null) return '—'
  return usd.format(value)
}

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
    breakdown: {
      realized: input.stats.realized.toString(),
      invested: input.stats.invested.toString(),
      held: input.stats.held,
      sold: input.stats.sold,
    },
  }

  // The same check replayed through a remount must not swap a stored quote for
  // a newer one, and a partial re-read must not replace the day's complete
  // measurement with an incomplete one. A row saved before the split existed
  // skips the replay branch so its breakdown can be filled in.
  const existing = await get<PnlRecord>('pnl-records', record.id)
  if (existing !== undefined) {
    if (record.createdAt < existing.createdAt) return existing
    if (!isComplete(record) && isComplete(existing)) return existing
    if (
      existing.createdAt === record.createdAt &&
      existing.ethPriceUsd !== null &&
      record.ethPriceUsd !== null &&
      existing.breakdown !== undefined
    ) {
      return existing
    }
  }

  // Upgrading a legacy row keeps the quote its original check stored.
  const stored: PnlRecord =
    existing !== undefined &&
    existing.createdAt === record.createdAt &&
    existing.breakdown === undefined &&
    existing.ethPriceUsd !== null
      ? { ...record, ethPriceUsd: existing.ethPriceUsd }
      : record

  await put<PnlRecord>('pnl-records', stored)
  return stored
}

export async function deletePnlRecord(id: string): Promise<void> {
  await remove('pnl-records', id)
}

// A check can finish before its price quote does. The quote arrives later, and
// it may only fill in the row that check already saved, never revive a row the
// monthly page deleted meanwhile.
export async function backfillQuote(
  contract: string,
  at: number,
  ethPriceUsd: number,
): Promise<void> {
  const existing = await get<PnlRecord>('pnl-records', recordId(contract, dayKey(new Date(at))))
  if (existing === undefined || existing.ethPriceUsd !== null) return
  await put<PnlRecord>('pnl-records', { ...existing, ethPriceUsd })
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
  return formatUsd(
    record.ethPriceUsd === null ? null : netEth(record) * record.ethPriceUsd,
  )
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
// set's series there. Partial reads are dropped, so the day they cover adds no
// delta and the next complete check absorbs its move.
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

export type PnlBreakdownValues = {
  realized: bigint
  unrealized: bigint
  invested: bigint
  holdings: bigint
  held: number
  sold: number
}

export type LifetimeCollection = {
  id: string
  name: string
  slug: string
  imageUrl: string
  chain: string
  checkedAt: number
  net: bigint
  usd: number | null
  breakdown: PnlBreakdownValues | null
  lastReadPartial: boolean
}

export type LifetimeMonth = {
  month: string
  change: bigint
  level: bigint
  tracked: boolean
}

export type LifetimeTotals = {
  measured: number
  excluded: number
  unquoted: number
  net: bigint | null
  realized: bigint | null
  unrealized: bigint | null
  invested: bigint | null
  holdings: bigint | null
  roi: number | null
  usd: {
    net: number | null
    realized: number | null
    unrealized: number | null
    invested: number | null
    holdings: number | null
  }
  from: string | null
}

export type LifetimeRanges = {
  tracked: number
  profitable: number
  streak: number
  average: bigint | null
  best: { month: string; change: bigint } | null
  worst: { month: string; change: bigint } | null
}

export type LifetimeView = {
  totals: LifetimeTotals
  ranges: LifetimeRanges
  collections: LifetimeCollection[]
  months: LifetimeMonth[]
}

type Measured = {
  collection: LifetimeCollection
  split: PnlBreakdownValues | null
  ethPriceUsd: number | null
}

// Both identities hold at write time, so unrealized and the holdings value are
// reconstructed here instead of stored a second time.
function breakdownOf(record: PnlRecord): PnlBreakdownValues | null {
  if (record.breakdown === undefined) return null
  const realized = BigInt(record.breakdown.realized)
  const invested = BigInt(record.breakdown.invested)
  const unrealized = netWei(record) - realized
  return {
    realized,
    unrealized,
    invested,
    holdings: invested + unrealized,
    held: record.breakdown.held,
    sold: record.breakdown.sold,
  }
}

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
}

function monthKey(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function lifetimeView(records: PnlRecord[]): LifetimeView {
  const groups = new Map<string, PnlRecord[]>()
  for (const record of records) {
    const key = record.contract.toLowerCase()
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, [record])
    } else {
      group.push(record)
    }
  }

  const measured: Measured[] = []
  let excluded = 0

  for (const group of groups.values()) {
    group.sort((a, b) => (isEarlier(a, b) ? -1 : isEarlier(b, a) ? 1 : 0))
    const latest = group.filter(isComplete).at(-1)
    if (latest === undefined) {
      excluded += 1
      continue
    }

    const split = breakdownOf(latest)
    measured.push({
      collection: {
        id: latest.id,
        name: latest.name,
        slug: latest.slug,
        imageUrl: latest.imageUrl,
        chain: latest.chain,
        checkedAt: latest.createdAt,
        net: netWei(latest),
        usd: latest.ethPriceUsd === null ? null : netEth(latest) * latest.ethPriceUsd,
        breakdown: split,
        lastReadPartial: group.some(
          (row) => !isComplete(row) && isEarlier(latest, row),
        ),
      },
      split,
      ethPriceUsd: latest.ethPriceUsd,
    })
  }

  const collections = measured
    .map((entry) => entry.collection)
    .sort((a, b) => b.checkedAt - a.checkedAt)

  const complete = records
    .filter(isComplete)
    .sort((a, b) => (isEarlier(a, b) ? -1 : isEarlier(b, a) ? 1 : 0))

  const changes = new Map<string, bigint>()
  const levels = new Map<string, bigint>()
  for (const record of complete) {
    const contract = record.contract.toLowerCase()
    const next = netWei(record)
    const month = record.day.slice(0, 7)
    const delta = next - (levels.get(contract) ?? 0n)
    changes.set(month, (changes.get(month) ?? 0n) + delta)
    levels.set(contract, next)
  }

  // Every calendar month between the first and last check is emitted, so the
  // chart holds a flat line across a month nobody checked instead of joining
  // the two neighbours.
  const months: LifetimeMonth[] = []
  if (complete.length > 0) {
    let level = 0n
    const first = monthIndex(complete[0].day)
    const last = monthIndex(complete[complete.length - 1].day)
    for (let index = first; index <= last; index += 1) {
      const month = monthKey(index)
      const change = changes.get(month) ?? 0n
      level += change
      months.push({ month, change, level, tracked: changes.has(month) })
    }
  }

  const measuredCount = measured.length
  const splits = measured.filter(
    (entry): entry is Measured & { split: PnlBreakdownValues } => entry.split !== null,
  )
  const legacy = measuredCount - splits.length
  const unquoted = measured.filter((entry) => entry.collection.usd === null).length

  const net =
    measuredCount === 0
      ? null
      : measured.reduce((sum, entry) => sum + entry.collection.net, 0n)
  const realized =
    measuredCount > 0 && legacy === 0
      ? splits.reduce((sum, entry) => sum + entry.split.realized, 0n)
      : null
  const invested =
    measuredCount > 0 && legacy === 0
      ? splits.reduce((sum, entry) => sum + entry.split.invested, 0n)
      : null
  const unrealized = net !== null && realized !== null ? net - realized : null
  const holdings =
    invested !== null && unrealized !== null ? invested + unrealized : null

  const quoted = measured.filter(
    (entry): entry is Measured & { split: PnlBreakdownValues; ethPriceUsd: number } =>
      entry.split !== null && entry.ethPriceUsd !== null,
  )
  const usdNet =
    measuredCount > 0 && unquoted === 0
      ? measured.reduce((sum, entry) => sum + (entry.collection.usd ?? 0), 0)
      : null
  const usdRealized =
    measuredCount > 0 && quoted.length === measuredCount
      ? quoted.reduce(
          (sum, entry) =>
            sum + (Number(entry.split.realized) / 10 ** 18) * entry.ethPriceUsd,
          0,
        )
      : null
  const usdInvested =
    measuredCount > 0 && quoted.length === measuredCount
      ? quoted.reduce(
          (sum, entry) =>
            sum + (Number(entry.split.invested) / 10 ** 18) * entry.ethPriceUsd,
          0,
        )
      : null
  const usdUnrealized =
    usdNet !== null && usdRealized !== null ? usdNet - usdRealized : null
  const usdHoldings =
    usdInvested !== null && usdUnrealized !== null
      ? usdInvested + usdUnrealized
      : null

  const tracked = months.filter((month) => month.tracked)
  let profitable = 0
  let streak = 0
  let run = 0
  let best: LifetimeRanges['best'] = null
  let worst: LifetimeRanges['worst'] = null

  for (const month of months) {
    if (!month.tracked) {
      run = 0
      continue
    }
    if (month.change > 0n) {
      profitable += 1
      run += 1
      streak = Math.max(streak, run)
    } else {
      run = 0
    }
    if (best === null || month.change > best.change) {
      best = { month: month.month, change: month.change }
    }
    if (worst === null || month.change < worst.change) {
      worst = { month: month.month, change: month.change }
    }
  }

  return {
    totals: {
      measured: measuredCount,
      excluded,
      unquoted,
      net,
      realized,
      unrealized,
      invested,
      holdings,
      roi:
        net !== null && invested !== null && invested > 0n
          ? Number(net) / Number(invested)
          : null,
      usd: {
        net: usdNet,
        realized: usdRealized,
        unrealized: usdUnrealized,
        invested: usdInvested,
        holdings: usdHoldings,
      },
      from: complete[0]?.day ?? null,
    },
    ranges: {
      tracked: tracked.length,
      profitable,
      streak,
      average:
        net !== null && tracked.length > 0
          ? net / BigInt(tracked.length)
          : null,
      best,
      worst,
    },
    collections,
    months,
  }
}
