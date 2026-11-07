import { chainBySlug } from '@/config/chains'
import type {
  ConsiderationItem,
  OrderComponentsLeaf,
} from '@/lib/seaport'
import type { ListingToken } from '@/lib/listing-plan'

export type OfferCurrency = {
  address: string
  symbol: string
  decimals: number
}

export type CollectionOffer = {
  id: string
  chain: string
  protocolAddress: `0x${string}`
  currency: OfferCurrency
  grossWei: bigint
  feeWei: bigint
  netWei: bigint
  remaining: number
  expiresAtSec: number
  parameters: OrderComponentsLeaf
}

export type OfferLadder = {
  currency: OfferCurrency
  offers: readonly CollectionOffer[]
  remainingUnits: number
}

export type OfferBook = {
  slug: string
  chain: string
  fetchedAtSec: number
  truncated: boolean
  ladders: readonly OfferLadder[]
}

export type SellTarget = {
  key: string
  address: string
  label: string
  chain: string
  contract: string
  tokenId: string
  offer: CollectionOffer
}

export type UncoveredReason = 'no-bid' | 'depth-exhausted'

export type SalesPlan = {
  currency: OfferCurrency | null
  targets: readonly SellTarget[]
  assigned: ReadonlyMap<string, CollectionOffer>
  uncovered: ReadonlyMap<string, UncoveredReason>
  totals: { grossWei: bigint; feeWei: bigint; netWei: bigint }
  expiresAtSec: number | null
}

const MONEY_ITEM_TYPES = new Set([0, 1])
const NFT_ITEM_TYPES = new Set([2, 3, 4, 5])

export function offerEconomics(input: {
  leaf: OrderComponentsLeaf
  remaining: number
  currency: { symbol: string; decimals: number }
}): Pick<
  CollectionOffer,
  'currency' | 'grossWei' | 'feeWei' | 'netWei' | 'expiresAtSec'
> | null {
  const { leaf, remaining } = input
  if (remaining < 1) return null

  if (
    leaf.offer.some((item) => item.startAmount !== item.endAmount) ||
    leaf.consideration.some((item) => item.startAmount !== item.endAmount)
  ) {
    return null
  }

  let moneyToken: string | null = null
  let grossTotal = 0n
  let feeTotal = 0n

  for (const item of leaf.offer) {
    if (!MONEY_ITEM_TYPES.has(item.itemType)) continue
    const address = item.token.toLowerCase()
    if (moneyToken === null) moneyToken = address
    else if (moneyToken !== address) return null
    grossTotal += BigInt(item.startAmount)
  }

  for (const item of leaf.consideration) {
    if (!MONEY_ITEM_TYPES.has(item.itemType)) continue
    const address = item.token.toLowerCase()
    if (moneyToken === null) moneyToken = address
    else if (moneyToken !== address) return null
    feeTotal += BigInt(item.startAmount)
  }

  if (moneyToken === null) return null

  let nftItem: ConsiderationItem | null = null
  for (const item of leaf.consideration) {
    if (!NFT_ITEM_TYPES.has(item.itemType)) continue
    if (nftItem !== null) return null
    nftItem = item
  }
  if (nftItem === null) return null

  const units = BigInt(nftItem.startAmount)
  if (units <= 0n) return null

  const grossWei = grossTotal / units
  const feeWei = feeTotal / units
  const netWei = grossWei - feeWei
  if (grossWei <= 0n || netWei <= 0n) return null

  const expiresAtSec = Number(leaf.endTime)
  if (!Number.isSafeInteger(expiresAtSec)) return null

  return {
    currency: {
      address: moneyToken,
      symbol: input.currency.symbol,
      decimals: input.currency.decimals,
    },
    grossWei,
    feeWei,
    netWei,
    expiresAtSec,
  }
}

function compareOffers(a: CollectionOffer, b: CollectionOffer): number {
  if (a.netWei !== b.netWei) return a.netWei > b.netWei ? -1 : 1
  if (a.expiresAtSec !== b.expiresAtSec) return a.expiresAtSec - b.expiresAtSec
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function assembleOfferBook(input: {
  slug: string
  chain: string
  fetchedAtSec: number
  truncated: boolean
  offers: readonly CollectionOffer[]
}): OfferBook {
  const byCurrency = new Map<string, CollectionOffer[]>()
  const seen = new Set<string>()

  for (const offer of input.offers) {
    if (seen.has(offer.id)) continue
    seen.add(offer.id)
    if (offer.expiresAtSec <= input.fetchedAtSec || offer.remaining < 1) continue
    const address = offer.currency.address
    const group = byCurrency.get(address) ?? []
    group.push(offer)
    byCurrency.set(address, group)
  }

  const ladders: OfferLadder[] = [...byCurrency.values()].map((offers) => {
    const sorted = [...offers].sort(compareOffers)
    return {
      currency: sorted[0].currency,
      offers: sorted,
      remainingUnits: sorted.reduce((sum, offer) => sum + offer.remaining, 0),
    }
  })

  ladders.sort((a, b) => {
    if (a.remainingUnits !== b.remainingUnits) {
      return b.remainingUnits - a.remainingUnits
    }
    if (a.offers.length !== b.offers.length) {
      return b.offers.length - a.offers.length
    }
    return a.currency.address < b.currency.address
      ? -1
      : a.currency.address > b.currency.address
        ? 1
        : 0
  })

  return {
    slug: input.slug,
    chain: input.chain,
    fetchedAtSec: input.fetchedAtSec,
    truncated: input.truncated,
    ladders,
  }
}

// An offer is live until its expiry second passes. The plan and the page's clock
// both read this predicate, so they cannot disagree about which offers are live.
function liveOffers(
  ladder: OfferLadder | null,
  nowSec: number
): readonly CollectionOffer[] {
  return ladder?.offers.filter((offer) => offer.expiresAtSec > nowSec) ?? []
}

export function nextOfferExpirySec(
  ladder: OfferLadder | null,
  nowSec: number
): number | null {
  let next: number | null = null
  for (const offer of liveOffers(ladder, nowSec)) {
    if (next === null || offer.expiresAtSec < next) next = offer.expiresAtSec
  }
  return next
}

export function planSales(input: {
  selected: readonly ListingToken[]
  ladder: OfferLadder | null
  nowSec: number
}): SalesPlan {
  const selected = [...input.selected].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  )
  const offers = liveOffers(input.ladder, input.nowSec)

  if (offers.length === 0) {
    const uncovered = new Map<string, UncoveredReason>()
    for (const token of selected) uncovered.set(token.key, 'no-bid')

    return {
      currency: input.ladder?.currency ?? null,
      targets: [],
      assigned: new Map(),
      uncovered,
      totals: { grossWei: 0n, feeWei: 0n, netWei: 0n },
      expiresAtSec: null,
    }
  }

  const depth = offers.map((offer) => offer.remaining)
  let cursor = 0
  const targets: SellTarget[] = []
  const assigned = new Map<string, CollectionOffer>()
  const uncovered = new Map<string, UncoveredReason>()

  for (const token of selected) {
    while (cursor < offers.length && depth[cursor] < 1) cursor += 1

    if (cursor >= offers.length) {
      uncovered.set(token.key, 'depth-exhausted')
      continue
    }

    const offer = offers[cursor]
    depth[cursor] -= 1
    assigned.set(token.key, offer)
    targets.push({
      key: token.key,
      address: token.address,
      label: token.label,
      chain: token.chain,
      contract: token.contract,
      tokenId: token.tokenId,
      offer,
    })
  }

  const totals = targets.reduce(
    (sum, target) => ({
      grossWei: sum.grossWei + target.offer.grossWei,
      feeWei: sum.feeWei + target.offer.feeWei,
      netWei: sum.netWei + target.offer.netWei,
    }),
    { grossWei: 0n, feeWei: 0n, netWei: 0n }
  )

  return {
    currency: offers[0].currency,
    targets,
    assigned,
    uncovered,
    totals,
    expiresAtSec:
      targets.length > 0
        ? Math.min(...targets.map((target) => target.offer.expiresAtSec))
        : null,
  }
}

export function explainSalesBlockers(input: {
  collection: { chain: string } | null
  offers: {
    status: 'idle' | 'loading' | 'ready' | 'failed'
    book: OfferBook | null
  }
  ladder: OfferLadder | null
  selected: readonly ListingToken[]
  plan: SalesPlan
}): string | null {
  if (input.collection === null) return 'Scan a collection to load bids'
  if (chainBySlug(input.collection.chain) === undefined) {
    return 'Chain not supported'
  }
  if (input.offers.status === 'loading' && input.offers.book === null) {
    return 'Loading offers…'
  }
  if (input.offers.status === 'failed' && input.offers.book === null) {
    return 'Offers could not be loaded — refresh'
  }
  if (input.ladder === null) return 'No active collection offers'
  if (input.selected.length === 0) return 'Select at least one token'
  if (input.plan.targets.length === 0) {
    return 'None of the selected tokens has a bid'
  }
  return null
}
