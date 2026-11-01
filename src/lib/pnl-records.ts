import { getAll, put } from '@/lib/db'
import { formatEth, type PnlStats } from '@/lib/pnl-trades'

// One row per collection, wallet set and local day. Re-checking the same
// collection on the same day rewrites that row instead of stacking a second
// sample, so the daily series never double counts a refresh.
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

export async function savePnlRecord(input: PnlRecordInput): Promise<PnlRecord> {
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

// Every day of the month is present, so the area keeps a flat zero on days
// without a check instead of stretching the neighbours across the gap.
export function dailyNetSeries(
  records: PnlRecord[],
  month: Date,
): { day: number; net: number }[] {
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const totals = new Array<number>(length).fill(0)

  for (const record of recordsInMonth(records, month)) {
    const index = Number(record.day.slice(8, 10)) - 1
    if (index >= 0 && index < length) {
      totals[index] += netEth(record)
    }
  }

  return totals.map((net, index) => ({ day: index + 1, net }))
}

export function monthNet(records: PnlRecord[]): { wei: bigint; usd: string } {
  let wei = 0n
  let usdTotal = 0
  let priced = 0

  for (const record of records) {
    wei += netWei(record)
    if (record.ethPriceUsd !== null) {
      usdTotal += netEth(record) * record.ethPriceUsd
      priced += 1
    }
  }

  // Checks run at different times carry different quotes, so each record's USD
  // value is converted at its own price and the month total is their sum. A
  // record saved without a price makes the month figure incomplete, not zero.
  const value =
    records.length > 0 && priced === records.length ? usd.format(usdTotal) : '—'

  return { wei, usd: value }
}

export function formatNetPnl(record: PnlRecord): string {
  return `${formatEth(netWei(record))} ETH`
}
