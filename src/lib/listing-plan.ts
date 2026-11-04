import { parseEther } from 'viem'
import {
  leavesOf,
  orderToken,
  parseDomain,
  splitConsideration,
  toSeaportParameters,
  typedDataForLeaf,
} from '@/lib/seaport'
import type {
  OrderComponentsLeaf,
  OrderFees,
  OrderTypedData,
  SeaportParameters,
} from '@/lib/seaport'
import type { CollectionFee, ListingActionEnvelope } from '@/lib/opensea'

// OpenSea rounds the end time it echoes back; a plan that demanded an exact
// match would reject its own request.
const END_TIME_TOLERANCE_SEC = 5 * 60

const MILLI = 1000n

export type ListingToken = {
  key: string
  address: string
  label: string
  chain: string
  contract: string
  tokenId: string
  quantity: number
}

export type PlannedApproval = {
  id: string
  kind: 'approval'
  address: string
  label: string
  chainId: number
  from: string
  to: string
  data: string
  value: string
}

export type PlannedOrder = {
  id: string
  kind: 'order'
  address: string
  label: string
  tokenKey: string
  token: { contract: string; tokenId: string }
  chain: string
  protocolAddress: string
  leaf: OrderComponentsLeaf
  parameters: SeaportParameters
  typedData: OrderTypedData
  fees: OrderFees
}

export type PlannedStep = PlannedApproval | PlannedOrder

export type PlannedWallet = {
  address: string
  label: string
  steps: PlannedStep[]
}

export type ListingPlan = {
  collection: { slug: string; name: string; chain: string }
  wallets: PlannedWallet[]
  priceWei: bigint
  durationDays: number
}

export type PlanFeeTotals = {
  grossWei: bigint
  feeWei: bigint
  netWei: bigint
}

export type ListingDuration = { days: number; label: string }

export type ListingBatch = {
  address: string
  label: string
  tokens: ListingToken[]
}

export type ListingPlanErrorCode =
  | 'missing-order'
  | 'duplicate-order'
  | 'offerer-mismatch'
  | 'chain-mismatch'
  | 'duration-not-honored'
  | 'approval-sender-mismatch'

export class ListingPlanError extends Error {
  readonly code: ListingPlanErrorCode

  constructor(code: ListingPlanErrorCode, message: string) {
    super(message)
    this.name = 'ListingPlanError'
    this.code = code
  }
}

export const listingDurationOptions: readonly ListingDuration[] = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days (1 month)' },
  { days: 90, label: '90 days (3 months)' },
]

export function parsePriceEth(text: string): bigint | null {
  const value = text.trim()
  if (!/^\d*\.?\d*$/.test(value) || !/\d/.test(value)) return null

  try {
    const wei = parseEther(value)
    return wei > 0n ? wei : null
  } catch {
    return null
  }
}

export function groupListingItems(
  tokens: readonly ListingToken[]
): ListingBatch[] {
  const batches = new Map<string, ListingBatch>()

  for (const token of tokens) {
    const address = token.address.toLowerCase()
    const batch = batches.get(address) ?? {
      address,
      label: token.label,
      tokens: [],
    }
    batch.tokens.push(token)
    batches.set(address, batch)
  }

  return [...batches.values()]
}

function sameToken(
  left: { contract: string; tokenId: string },
  right: { contract: string; tokenId: string }
): boolean {
  return (
    left.contract.toLowerCase() === right.contract.toLowerCase() &&
    left.tokenId === right.tokenId
  )
}

function planWallet(input: {
  batch: ListingBatch
  envelopes: readonly ListingActionEnvelope[]
  chainId: number
  expectedEndSec: number
  chain: string
}): PlannedWallet {
  const address = input.batch.address
  const approvals: PlannedApproval[] = []
  const orders = new Map<string, PlannedOrder>()

  for (const envelope of input.envelopes) {
    if (envelope.chainId !== input.chainId) {
      throw new ListingPlanError(
        'chain-mismatch',
        `OpenSea answered for chain ${envelope.chainId}, expected ${input.chainId}`
      )
    }

    if (envelope.kind === 'approval') {
      if (envelope.from.toLowerCase() !== address) {
        throw new ListingPlanError(
          'approval-sender-mismatch',
          `OpenSea asked ${envelope.from} to approve, expected ${address}`
        )
      }

      approvals.push({
        id: `approval:${address}:${approvals.length}`,
        kind: 'approval',
        address,
        label: input.batch.label,
        chainId: envelope.chainId,
        from: envelope.from,
        to: envelope.to,
        data: envelope.data,
        value: envelope.value,
      })
      continue
    }

    const leafDomain = parseDomain(envelope.typedData.domain)
    if (leafDomain.chainId !== input.chainId) {
      throw new ListingPlanError(
        'chain-mismatch',
        `Orders are signed for chain ${leafDomain.chainId}, expected ${input.chainId}`
      )
    }

    for (const leaf of leavesOf(envelope.typedData)) {
      if (leaf.offerer.toLowerCase() !== address) {
        throw new ListingPlanError(
          'offerer-mismatch',
          `Order is signed by ${leaf.offerer}, expected ${address}`
        )
      }

      const endSec = Number(leaf.endTime)
      if (Math.abs(endSec - input.expectedEndSec) > END_TIME_TOLERANCE_SEC) {
        throw new ListingPlanError(
          'duration-not-honored',
          'OpenSea did not apply the requested listing duration'
        )
      }

      const token = orderToken(leaf)
      const match = input.batch.tokens.find((candidate) =>
        sameToken(candidate, token)
      )
      // The payload may carry leaves for assets outside the request; only the
      // selected tokens are planned.
      if (!match) continue

      if (orders.has(match.key)) {
        throw new ListingPlanError(
          'duplicate-order',
          `OpenSea returned two orders for token #${match.tokenId}`
        )
      }

      orders.set(match.key, {
        id: `order:${match.key}`,
        kind: 'order',
        address,
        label: input.batch.label,
        tokenKey: match.key,
        token,
        chain: input.chain,
        protocolAddress: envelope.protocolAddress,
        leaf,
        parameters: toSeaportParameters(leaf),
        typedData: typedDataForLeaf(leaf, leafDomain),
        fees: splitConsideration(leaf),
      })
    }
  }

  const missing = input.batch.tokens.find((token) => !orders.has(token.key))
  if (missing) {
    throw new ListingPlanError(
      'missing-order',
      `OpenSea returned no order for token #${missing.tokenId}`
    )
  }

  return {
    address,
    label: input.batch.label,
    steps: [...approvals, ...orders.values()],
  }
}

export function buildListingPlan(input: {
  collection: { slug: string; name: string; chain: string }
  chainId: number
  tokens: readonly ListingToken[]
  priceWei: bigint
  durationDays: number
  envelopes: readonly {
    address: string
    label: string
    envelopes: readonly ListingActionEnvelope[]
  }[]
}): ListingPlan {
  const expectedEndSec =
    Math.floor(Date.now() / 1000) + input.durationDays * 24 * 60 * 60
  const byAddress = new Map(
    input.envelopes.map((entry) => [entry.address.toLowerCase(), entry])
  )

  const wallets = groupListingItems(input.tokens).map((batch) =>
    planWallet({
      batch,
      envelopes: byAddress.get(batch.address)?.envelopes ?? [],
      chainId: input.chainId,
      expectedEndSec,
      chain: input.collection.chain,
    })
  )

  return {
    collection: input.collection,
    wallets,
    priceWei: input.priceWei,
    durationDays: input.durationDays,
  }
}

export function planOrders(plan: ListingPlan): PlannedOrder[] {
  return plan.wallets.flatMap((wallet) =>
    wallet.steps.filter((step): step is PlannedOrder => step.kind === 'order')
  )
}

export function planFeeTotals(plan: ListingPlan): PlanFeeTotals {
  const totals: PlanFeeTotals = { grossWei: 0n, feeWei: 0n, netWei: 0n }

  for (const order of planOrders(plan)) {
    totals.grossWei += order.fees.grossWei
    totals.feeWei += order.fees.feeWei
    totals.netWei += order.fees.netWei
  }

  return totals
}

export function estimateFeeTotals(input: {
  fees: readonly CollectionFee[]
  priceWei: bigint
  units: number
}): PlanFeeTotals {
  // ERC-1155 holdings can be fractional, so the unit count is scaled to
  // thousandths before it meets bigint arithmetic.
  const unitsMilli = BigInt(Math.round(Math.max(0, input.units) * 1000))
  const grossWei = (input.priceWei * unitsMilli) / MILLI
  let feeWei = 0n

  for (const fee of input.fees) {
    const basisPoints = BigInt(Math.round(fee.percent * 100))
    feeWei += (grossWei * basisPoints) / 10_000n
  }

  return { grossWei, feeWei, netWei: grossWei - feeWei }
}

export function explainPlanBlockers(input: {
  selected: readonly ListingToken[]
  priceWei: bigint | null
  chainSupported: boolean
}): string | null {
  if (input.selected.length === 0) return 'Select at least one token'
  if (!input.chainSupported) return 'Chain not supported'
  if (input.priceWei === null) return 'Enter a price per item'
  return null
}
