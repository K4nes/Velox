const MAX_PAGES = 5
const REQUEST_TIMEOUT_MS = 15_000
const FLOW_CONCURRENCY = 4
const WEI = 10n ** 18n
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export type ChainTrade = {
  wallet: string
  tokenId: string
  side: 'buy' | 'sell'
  amount: bigint
  blockNumber: number
  burn: boolean
  counterparty: string
}

export type TradesRead = {
  trades: ChainTrade[]
  truncated: boolean
  unpriced: boolean
}

export type PnlStats = {
  realized: bigint
  spent: bigint // every buy's outlay, including lots since sold
  basis: bigint // cost of the lots still open
  currentValue: bigint
  unrealized: bigint
  held: number
  sold: number
}

type RawTransfer = {
  from?: { hash?: string }
  to?: { hash?: string }
  total?: { token_id?: string | null; value?: string }
  token?: { address_hash?: string; decimals?: string | number | null }
  transaction_hash?: string
  block_number?: number | string
}

type ExplorerPage<T> = {
  items?: T[]
  next_page_params?: Record<string, string | number | boolean> | null
}

type RawTransaction = {
  from?: { hash?: string } | null
  to?: { hash?: string } | null
  value?: string
}

type RawInternalTransaction = {
  from?: { hash?: string }
  to?: { hash?: string }
  value?: string
}

type Flow = { from: string; to: string; amount: bigint }

type TxFlows = {
  sender: string | null
  receiver: string | null
  value: bigint
  internals: Flow[]
  erc20: Flow[]
  otherTokens: Flow[]
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(url, {
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`)
  }
  return (await response.json()) as T
}

function parseWei(raw: string | undefined): bigint | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  return BigInt(raw)
}

function parseDecimals(raw: string | number | null | undefined): number | null {
  // The explorer is a remote input, so the exponent is bounded before 10n ** n.
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 && raw <= 36 ? raw : null
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    const value = Number(raw)
    return value <= 36 ? value : null
  }
  return null
}

// Every amount in this module is wei, so a token amount is rescaled to 18
// decimals before it can be compared with a native payment.
function asWei(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount
  if (decimals < 18) return amount * 10n ** BigInt(18 - decimals)
  return amount / 10n ** BigInt(decimals - 18)
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

type TransferList = { transfers: RawTransfer[]; truncated: boolean }

// Returns true when the page cap cut the list short.
async function collectPages<T>(
  base: string,
  initial: URLSearchParams,
  signal: AbortSignal | undefined,
  visit: (items: T[]) => void,
): Promise<boolean> {
  let query = new URLSearchParams(initial)

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const search = query.toString()
    const url = search === '' ? base : `${base}?${search}`
    const body = await getJson<ExplorerPage<T>>(url, signal)
    visit(body.items ?? [])
    if (body.next_page_params === null || body.next_page_params === undefined) {
      return false
    }

    query = new URLSearchParams(query)
    for (const [key, value] of Object.entries(body.next_page_params)) {
      query.set(key, String(value))
    }
  }

  return true
}

async function listTransfers(
  explorerApi: string,
  contract: string,
  address: string,
  signal?: AbortSignal,
): Promise<TransferList> {
  const transfers: RawTransfer[] = []
  const truncated = await collectPages<RawTransfer>(
    `${explorerApi}/addresses/${address}/token-transfers`,
    new URLSearchParams({ type: 'ERC-721', token: contract }),
    signal,
    (items) => {
      transfers.push(...items)
    },
  )

  // The explorer lists newest first. Reversing restores the order the chain
  // executed the transfers, which the stable sort in summarize preserves.
  return { transfers: transfers.reverse(), truncated }
}

type FlowRead = { flows: TxFlows; truncated: boolean }

async function loadFlows(
  explorerApi: string,
  hash: string,
  wrappedNative: string,
  signal?: AbortSignal,
): Promise<FlowRead> {
  const base = `${explorerApi}/transactions/${hash}`
  const transaction = await getJson<RawTransaction>(base, signal)
  const root = {
    from: transaction.from?.hash?.toLowerCase() ?? null,
    to: transaction.to?.hash?.toLowerCase() ?? null,
    value: parseWei(transaction.value) ?? 0n,
  }

  const internals: Flow[] = []
  const erc20: Flow[] = []
  const otherTokens: Flow[] = []
  const wrapped = wrappedNative.toLowerCase()

  const [internalsCut, transfersCut] = await Promise.all([
    collectPages<RawInternalTransaction>(
      `${base}/internal-transactions`,
      new URLSearchParams(),
      signal,
      (items) => {
        for (const item of items) {
          const amount = parseWei(item.value)
          const from = item.from?.hash?.toLowerCase()
          const to = item.to?.hash?.toLowerCase()
          if (amount === null || amount === 0n) continue
          if (from === undefined || to === undefined) continue
          // The explorer lists the root call again as an internal one, so all
          // three fields have to match for it to be the same native leg.
          if (from === root.from && to === root.to && amount === root.value) continue
          internals.push({ from, to, amount })
        }
      },
    ),
    // Only the wrapped native token moves money. Any other ERC-20 in the same
    // transaction is an airdrop or a fee token and must not shift the price, so
    // its legs are kept only to spot a purchase this card cannot price.
    collectPages<RawTransfer>(
      `${base}/token-transfers`,
      new URLSearchParams(),
      signal,
      (items) => {
        for (const item of items) {
          const amount = parseWei(item.total?.value)
          const from = item.from?.hash?.toLowerCase()
          const to = item.to?.hash?.toLowerCase()
          if (amount === null || from === undefined || to === undefined) continue
          const decimals = parseDecimals(item.token?.decimals) ?? 18
          const leg = { from, to, amount: asWei(amount, decimals) }
          if (item.token?.address_hash?.toLowerCase() === wrapped) erc20.push(leg)
          else otherTokens.push(leg)
        }
      },
    ),
  ])

  return {
    flows: {
      sender: root.from,
      receiver: root.to,
      value: root.value,
      internals,
      erc20,
      otherTokens,
    },
    truncated: internalsCut || transfersCut,
  }
}

type MoneyFlow = { inflow: bigint; outflow: bigint }

type WalletTransfer = {
  tokenId: string
  blockNumber: number
  burn: boolean
  counterparty: string
}

type TradeGroup = {
  hash: string
  side: ChainTrade['side']
  transfers: WalletTransfer[]
}

function addFlow(money: MoneyFlow, wallet: string, flow: Flow): void {
  if (flow.to === wallet) money.inflow += flow.amount
  if (flow.from === wallet) money.outflow += flow.amount
}

function moneyFlow(wallet: string, flows: TxFlows): MoneyFlow {
  const money: MoneyFlow = { inflow: 0n, outflow: 0n }
  if (flows.receiver === wallet) money.inflow += flows.value
  if (flows.sender === wallet) money.outflow += flows.value
  for (const flow of flows.internals) addFlow(money, wallet, flow)
  for (const flow of flows.erc20) addFlow(money, wallet, flow)
  return money
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

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export async function fetchCollectionTrades(
  explorerApi: string,
  contract: string,
  addresses: string[],
  wrappedNative: string,
  signal?: AbortSignal,
): Promise<TradesRead> {
  const wallets = [...new Set(addresses.map((address) => address.toLowerCase()))]
  const flows = new Map<string, Promise<FlowRead>>()
  const trades: ChainTrade[] = []
  let truncated = false
  let unpriced = false

  function flowsFor(hash: string): Promise<FlowRead> {
    const key = hash.toLowerCase()
    const cached = flows.get(key)
    if (cached !== undefined) return cached
    const pending = loadFlows(explorerApi, key, wrappedNative, signal)
    flows.set(key, pending)
    return pending
  }

  for (const wallet of wallets) {
    const listed = await listTransfers(explorerApi, contract, wallet, signal)
    if (listed.truncated) truncated = true
    const groups = new Map<string, TradeGroup>()

    for (const transfer of listed.transfers) {
      const hash = transfer.transaction_hash
      const tokenId = transfer.total?.token_id
      const from = transfer.from?.hash?.toLowerCase()
      const to = transfer.to?.hash?.toLowerCase()
      if (hash === undefined || tokenId === undefined || tokenId === null) continue
      if (from === undefined || to === undefined) continue

      const side = to === wallet ? 'buy' : from === wallet ? 'sell' : null
      if (side === null) continue
      // A transfer a wallet makes to itself does not move the token.
      if (from === to) continue

      const key = `${hash.toLowerCase()}:${side}`
      let group = groups.get(key)
      if (group === undefined) {
        group = { hash, side, transfers: [] }
        groups.set(key, group)
      }
      group.transfers.push({
        tokenId,
        blockNumber: blockNumberOf(transfer),
        burn: to === ZERO_ADDRESS,
        counterparty: (side === 'buy' ? from : to).toLowerCase(),
      })
    }

    // One transaction can carry both directions for the same wallet. The money
    // it moved cannot be split between them, so both groups are left out.
    const sides = new Map<string, number>()
    for (const group of groups.values()) {
      const key = group.hash.toLowerCase()
      sides.set(key, (sides.get(key) ?? 0) + 1)
    }

    const grouped = await mapPool([...groups.values()], FLOW_CONCURRENCY, async (group) => {
      const read = await flowsFor(group.hash)
      const flow = moneyFlow(wallet, read.flows)
      const amount = groupAmount(group.side, flow)
      const paidInAnotherToken = read.flows.otherTokens.some(
        (leg) => leg.from === wallet || leg.to === wallet,
      )
      const ambiguous = (sides.get(group.hash.toLowerCase()) ?? 0) > 1

      if (ambiguous || (group.side === 'buy' && amount === 0n && paidInAnotherToken)) {
        unpriced = true
        return []
      }

      const shares = splitEvenly(amount, group.transfers.length)
      return group.transfers.map((transfer, index) => ({
        wallet,
        tokenId: transfer.tokenId,
        side: group.side,
        amount: shares[index],
        blockNumber: transfer.blockNumber,
        burn: transfer.burn,
        counterparty: transfer.counterparty,
      }))
    })

    for (const rows of grouped) trades.push(...rows)
  }

  for (const read of await Promise.all(flows.values())) {
    if (read.truncated) truncated = true
  }

  return { trades, truncated, unpriced }
}

type TokenBook = {
  lots: bigint[]
  sellCount: number
  lastSell: bigint | null
}

const bookKey = (trade: ChainTrade) => `${trade.wallet.toLowerCase()}:${trade.tokenId}`

export function summarize(trades: ChainTrade[]): PnlStats {
  const ordered = [...trades].sort((a, b) => a.blockNumber - b.blockNumber)
  const books = new Map<string, TokenBook>()
  const bookFor = (trade: ChainTrade): TokenBook => {
    const key = bookKey(trade)
    let book = books.get(key)
    if (book === undefined) {
      book = { lots: [], sellCount: 0, lastSell: null }
      books.set(key, book)
    }
    return book
  }

  // A transfer between two selected wallets moves the token and its basis, so
  // the receiving wallet has to pick up the cost the sender paid for the lot.
  // Both sides are collected before they are paired, because the wallet chunks
  // arrive in whatever order the wallet store lists them.
  const handsOff = new Map<number, number>()
  const receives = new Set<number>()
  const outgoing = new Map<string, number[]>()

  for (const [index, trade] of ordered.entries()) {
    if (trade.amount !== 0n || trade.burn || trade.side !== 'sell') continue
    const key = `${trade.blockNumber}:${trade.tokenId}:${trade.wallet.toLowerCase()}:${trade.counterparty}`
    const queue = outgoing.get(key)
    if (queue === undefined) outgoing.set(key, [index])
    else queue.push(index)
  }

  for (const [index, trade] of ordered.entries()) {
    if (trade.amount !== 0n || trade.burn || trade.side !== 'buy') continue
    const source = outgoing.get(
      `${trade.blockNumber}:${trade.tokenId}:${trade.counterparty}:${trade.wallet.toLowerCase()}`,
    )?.shift()
    if (source === undefined) continue
    handsOff.set(source, index)
    receives.add(index)
  }

  // A block is walked in dependency order, so a handoff lands before the wallet
  // that receives it spends or re-buys the token. Order inside a book is the
  // chunk order, which is already the chain order for that wallet.
  const blocks = new Map<number, number[]>()
  ordered.forEach((trade, index) => {
    const rows = blocks.get(trade.blockNumber)
    if (rows === undefined) blocks.set(trade.blockNumber, [index])
    else rows.push(index)
  })

  const sequence: number[] = []

  for (const rows of blocks.values()) {
    const position = new Map<number, number>()
    rows.forEach((index, order) => position.set(index, order))

    const next = new Map<number, number[]>()
    const indegree = new Map<number, number>()
    const link = (from: number, to: number) => {
      const edges = next.get(from)
      if (edges === undefined) next.set(from, [to])
      else edges.push(to)
      indegree.set(to, (indegree.get(to) ?? 0) + 1)
    }

    const lastOf = new Map<string, number>()
    for (const index of rows) {
      const key = bookKey(ordered[index])
      const previous = lastOf.get(key)
      if (previous !== undefined) link(previous, index)
      lastOf.set(key, index)
    }

    // Every edge inside a book plus the handoff edges already order a chain, so
    // a round trip in one block stays acyclic and keeps its chunk order.
    for (const [source, receiver] of handsOff) {
      if (position.has(source) && position.has(receiver)) link(source, receiver)
    }

    const ready = rows.filter((index) => (indegree.get(index) ?? 0) === 0)
    const walked = new Set<number>()
    let cursor = 0

    while (cursor < ready.length) {
      const index = ready[cursor]
      cursor += 1
      sequence.push(index)
      walked.add(index)
      for (const target of next.get(index) ?? []) {
        const left = (indegree.get(target) ?? 0) - 1
        indegree.set(target, left)
        if (left !== 0) continue
        let insert = cursor
        while (
          insert < ready.length &&
          (position.get(ready[insert]) ?? 0) < (position.get(target) ?? 0)
        ) {
          insert += 1
        }
        ready.splice(insert, 0, target)
      }
    }

    // A handoff cycle cannot be ordered, so those rows keep their chunk order.
    sequence.push(...rows.filter((index) => !walked.has(index)))
  }

  let collectionMark: bigint | null = null
  let realized = 0n
  let spent = 0n

  for (const index of sequence) {
    const trade = ordered[index]
    const book = bookFor(trade)

    if (trade.side === 'buy') {
      // The receiving wallet of a transfer already holds the sender's basis.
      // A handoff buy carries amount 0n because pairing requires it, so this
      // guard states that a moved basis is not new spend.
      if (!receives.has(index)) {
        book.lots.push(trade.amount)
        spent += trade.amount
      }
      // The wallet's own sale is older than this lot, so it cannot mark it.
      book.lastSell = null
      continue
    }

    book.sellCount += 1

    const cost = book.lots.shift()
    const receiver = handsOff.get(index)

    if (receiver !== undefined) {
      if (cost !== undefined) bookFor(ordered[receiver]).lots.push(cost)
    } else if (cost !== undefined && (trade.amount > 0n || trade.burn)) {
      // An empty queue means the buy sits outside the read window. A zero basis
      // would turn the whole proceeds into profit, so this sale books nothing.
      // A transfer out that paid nothing is not a sale either.
      realized += trade.amount - cost
    }

    // A burn or a free transfer out is not a sale, so it says nothing about
    // what the tokens still held are worth.
    if (trade.amount > 0n && !trade.burn) {
      book.lastSell = trade.amount
      collectionMark = trade.amount
    }
  }

  let basis = 0n
  let currentValue = 0n
  let held = 0
  let sold = 0

  for (const book of books.values()) {
    if (book.sellCount > 0) sold += 1
    if (book.lots.length === 0) continue

    const open = book.lots.reduce((sum, lot) => sum + lot, 0n)
    basis += open
    currentValue += book.lastSell ?? collectionMark ?? open
    held += 1
  }

  return {
    realized,
    spent,
    basis,
    currentValue,
    unrealized: currentValue - basis,
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
