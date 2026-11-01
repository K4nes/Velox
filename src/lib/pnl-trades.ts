const MAX_PAGES = 5
const WEI = 10n ** 18n

export type ChainTrade = {
  wallet: string
  tokenId: string
  side: 'buy' | 'sell'
  amount: bigint
  blockNumber: number
}

export type PnlStats = {
  realized: bigint
  invested: bigint
  currentValue: bigint
  unrealized: bigint
  held: number
  sold: number
}

type RawTransfer = {
  from?: { hash?: string }
  to?: { hash?: string }
  total?: { token_id?: string | null; value?: string }
  token?: { type?: string }
  transaction_hash?: string
  block_number?: number | string
}

type RawTransferPage = {
  items?: RawTransfer[]
  next_page_params?: Record<string, string | number | boolean> | null
}

type RawTransaction = {
  to?: { hash?: string } | null
  value?: string
}

type Erc20Flow = { from: string; to: string; amount: bigint }

type TxFlows = {
  native: bigint
  receiver: string | null
  erc20: Erc20Flow[]
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`)
  }
  return (await response.json()) as T
}

function parseWei(raw: string | undefined): bigint | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  return BigInt(raw)
}

function blockNumberOf(transfer: RawTransfer): number {
  const raw = transfer.block_number
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

async function listTransfers(
  explorerApi: string,
  contract: string,
  address: string,
): Promise<RawTransfer[]> {
  const base = `${explorerApi}/addresses/${address}/token-transfers`
  let query = new URLSearchParams({ type: 'ERC-721', token: contract })
  const transfers: RawTransfer[] = []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await getJson<RawTransferPage>(`${base}?${query.toString()}`)
    transfers.push(...(body.items ?? []))
    if (body.next_page_params === null || body.next_page_params === undefined) break

    query = new URLSearchParams(query)
    for (const [key, value] of Object.entries(body.next_page_params)) {
      query.set(key, String(value))
    }
  }

  return transfers
}

// An NFT movement carries a token id, and some explorers still report a value
// for it, so the id test is what separates a fungible amount from a token count.
function isFungible(item: RawTransfer): boolean {
  const type = item.token?.type
  if (type !== undefined) return type === 'ERC-20'
  const tokenId = item.total?.token_id
  return tokenId === undefined || tokenId === null
}

async function loadFlows(explorerApi: string, hash: string): Promise<TxFlows> {
  const [transaction, page] = await Promise.all([
    getJson<RawTransaction>(`${explorerApi}/transactions/${hash}`),
    getJson<RawTransferPage>(`${explorerApi}/transactions/${hash}/token-transfers`),
  ])

  const erc20: Erc20Flow[] = []
  for (const item of page.items ?? []) {
    const amount = parseWei(item.total?.value)
    const from = item.from?.hash?.toLowerCase()
    const to = item.to?.hash?.toLowerCase()
    if (amount === null || !isFungible(item)) continue
    if (from === undefined || to === undefined) continue
    erc20.push({ from, to, amount })
  }

  return {
    native: parseWei(transaction.value) ?? 0n,
    receiver: transaction.to?.hash?.toLowerCase() ?? null,
    erc20,
  }
}

type MoneyFlow = { inflow: bigint; outflow: bigint }

type WalletTransfer = { tokenId: string; blockNumber: number }

type TradeGroup = {
  hash: string
  side: ChainTrade['side']
  transfers: WalletTransfer[]
}

function moneyFlow(wallet: string, flows: TxFlows): MoneyFlow {
  const receivesNative = flows.receiver === wallet
  let inflow = receivesNative ? flows.native : 0n
  let outflow = receivesNative ? 0n : flows.native

  for (const flow of flows.erc20) {
    if (flow.to === wallet) inflow += flow.amount
    if (flow.from === wallet) outflow += flow.amount
  }

  return { inflow, outflow }
}

function groupAmount(side: ChainTrade['side'], flow: MoneyFlow): bigint {
  if (side === 'buy') return flow.outflow
  return flow.inflow > flow.outflow ? flow.inflow - flow.outflow : 0n
}

function splitEvenly(total: bigint, count: number): bigint[] {
  const base = total / BigInt(count)
  const shares = Array.from({ length: count }, () => base)
  shares[count - 1] += total - base * BigInt(count)
  return shares
}

export async function fetchCollectionTrades(
  explorerApi: string,
  contract: string,
  addresses: string[],
): Promise<ChainTrade[]> {
  const wallets = [...new Set(addresses.map((address) => address.toLowerCase()))]
  const flows = new Map<string, Promise<TxFlows>>()
  const trades: ChainTrade[] = []

  function flowsFor(hash: string): Promise<TxFlows> {
    const key = hash.toLowerCase()
    const cached = flows.get(key)
    if (cached !== undefined) return cached
    const pending = loadFlows(explorerApi, key)
    flows.set(key, pending)
    return pending
  }

  for (const wallet of wallets) {
    const transfers = await listTransfers(explorerApi, contract, wallet)
    const groups = new Map<string, TradeGroup>()

    for (const transfer of transfers) {
      const hash = transfer.transaction_hash
      const tokenId = transfer.total?.token_id
      const from = transfer.from?.hash?.toLowerCase()
      const to = transfer.to?.hash?.toLowerCase()
      if (hash === undefined || tokenId === undefined || tokenId === null) continue
      if (from === undefined || to === undefined) continue

      const side = to === wallet ? 'buy' : from === wallet ? 'sell' : null
      if (side === null) continue

      const key = `${hash.toLowerCase()}:${side}`
      let group = groups.get(key)
      if (group === undefined) {
        group = { hash, side, transfers: [] }
        groups.set(key, group)
      }
      group.transfers.push({ tokenId, blockNumber: blockNumberOf(transfer) })
    }

    const grouped = await Promise.all(
      [...groups.values()].map(async (group): Promise<ChainTrade[]> => {
        const flow = moneyFlow(wallet, await flowsFor(group.hash))
        const total = groupAmount(group.side, flow)
        if (total <= 0n) return []

        const shares = splitEvenly(total, group.transfers.length)
        return group.transfers.map((transfer, index) => ({
          wallet,
          tokenId: transfer.tokenId,
          side: group.side,
          amount: shares[index],
          blockNumber: transfer.blockNumber,
        }))
      }),
    )

    for (const rows of grouped) trades.push(...rows)
  }

  return trades
}

type TokenBook = {
  buys: bigint
  sells: bigint
  buyCount: number
  sellCount: number
  lastSell: bigint | null
}

export function summarize(trades: ChainTrade[]): PnlStats {
  const ordered = [...trades].sort((a, b) => a.blockNumber - b.blockNumber)
  const books = new Map<string, TokenBook>()
  let collectionMark: bigint | null = null

  for (const trade of ordered) {
    const key = `${trade.wallet.toLowerCase()}:${trade.tokenId}`
    let book = books.get(key)
    if (book === undefined) {
      book = { buys: 0n, sells: 0n, buyCount: 0, sellCount: 0, lastSell: null }
      books.set(key, book)
    }

    if (trade.side === 'buy') {
      book.buys += trade.amount
      book.buyCount += 1
    } else {
      book.sells += trade.amount
      book.sellCount += 1
      book.lastSell = trade.amount
      collectionMark = trade.amount
    }
  }

  let realized = 0n
  let invested = 0n
  let currentValue = 0n
  let held = 0
  let sold = 0

  for (const book of books.values()) {
    if (book.sellCount > 0) {
      realized += book.sells - book.buys
      sold += 1
    }

    if (book.buyCount > book.sellCount) {
      invested += book.buys
      currentValue += book.lastSell ?? collectionMark ?? book.buys
      held += 1
    }
  }

  return {
    realized,
    invested,
    currentValue,
    unrealized: currentValue - invested,
    held,
    sold,
  }
}

export function formatEth(value: bigint, digits = 4): string {
  const sign = value < 0n ? '-' : ''
  const abs = value < 0n ? -value : value
  if (digits === 0) return `${sign}${abs / WEI}`

  const factor = 10n ** BigInt(digits)
  const scaled = (abs * factor + WEI / 2n) / WEI
  const whole = scaled / factor
  const fraction = (scaled % factor).toString().padStart(digits, '0')
  return `${sign}${whole}.${fraction}`
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

export function toUsd(value: bigint, price: number | null): string {
  if (price === null) return '—'
  return currency.format((Number(value) / 10 ** 18) * price)
}
