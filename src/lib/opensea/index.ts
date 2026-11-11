import { formatUnits } from 'viem'
import { resolveKeys } from '@/lib/chain/connections'
import { OPENSEA_BASE_URL, OPENSEA_TIMEOUT_MS, httpExchange, readErrorBody } from '@/lib/chain/http'
import { traceMint } from '@/lib/mint/mint-trace'
import { OpenSeaError } from '@/lib/opensea/error'
import { offerEconomics } from '@/lib/offers/instant-sell'
import type { CollectionOffer } from '@/lib/offers/instant-sell'
import {
  parseOrderComponents,
  type OrderComponentsLeaf,
  type SeaportParameters,
} from '@/lib/opensea/seaport'

const MAX_RETRY_ATTEMPTS = 2
const MAX_RETRY_WAIT_MS = 30_000
// http.ts reports a wait only from `Retry-After` or `X-RateLimit-Reset`; when
// neither gives one the retry waits blind. http.ts notes a fixed wait can retry
// into the same empty bucket, and MAX_RETRY_ATTEMPTS bounds how often. Both the
// 429 and the 503 branch fall back to it: a 429 waits out a rate-limit bucket,
// while a 503 is a transient failure with no bucket to wait for.
const NO_HEADER_RETRY_WAIT_MS = 2_000

// measured 2026-11-03: 91 identifiers -> 400 "identifiers must not exceed 30 items"
export const NFT_BATCH_MAX = 30

export type RarityIndex = {
  maxRank: number
}

export type CollectionFee = { percent: number; required: boolean }

export type ListingCurrency = { address: string; symbol: string; decimals: number }

export type CollectionInfo = {
  slug: string
  name: string
  chain: string
  contractAddress: string
  imageUrl: string
  totalSupply: number | null
  rarity: RarityIndex | null
  fees: CollectionFee[]
  listingCurrency: ListingCurrency
}

export type CollectionStats = {
  floorPrice: number | null
  floorSymbol: string
}

export type AccountNft = {
  chain: string
  contractAddress: string
  tokenId: string
  name: string
  imageUrl: string
  openseaUrl: string
  quantity: number
  decimals: number
}

export type AccountNftPage = { nfts: AccountNft[]; next: string | null }

export type NftRank = { tokenId: string; rank: number | null }

export type DropStage = {
  uuid: string
  stageType: string
  label: string
  priceWei: string
  maxPerWallet: string
  startTime: string
  endTime: string
}

export type DropInfo = {
  slug: string
  name: string
  chain: string
  contractAddress: string
  dropType: string
  isMinting: boolean
  maxSupply: string
  totalSupply: string
  activeStage: DropStage | null
  nextStage: DropStage | null
  stages: DropStage[]
}

export type StageEligibility = {
  stageUuid: string
  eligible: boolean
  maxMintable: string
  priceWei: string
}

export type EligibilityResponse = { stages: StageEligibility[] }

export type MintTransaction = {
  chain: string
  to: string
  data: string
  value: string
}

export type OfferFulfillmentTransaction = {
  chainId: number
  to: `0x${string}`
  value: string
  functionName: string
  inputData: Record<string, unknown>
  calldataSuffix: `0x${string}` | null
}

type RequestOptions = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

function normalizeSlug(candidate: string): string | null {
  const slug = candidate.toLowerCase()
  if (/^\d+$/.test(slug)) return null
  // A contract address is a legitimate collection identifier. OpenSea returns it
  // verbatim as `collection` for collections that have no text slug.
  if (/^0x[0-9a-f]{40}$/.test(slug)) return slug
  if (/^0x[0-9a-f]+$/.test(slug)) return null
  return slug
}

export function slugFromUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  // A bare slug has no slash and no scheme; `new URL` would read it as a host
  // and leave the path empty, so it never reaches the segment walk below.
  if (!value.includes('/')) {
    return normalizeSlug(value)
  }

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    const segments = url.pathname.split('/').filter(Boolean)
    const marker = segments.findIndex((part) => {
      const segment = part.toLowerCase()
      return segment === 'collection' || segment === 'marketplace'
    })
    if (marker !== -1 && !segments[marker + 1]) return null
    const candidate = marker !== -1 ? segments[marker + 1] : segments.at(-1)
    if (!candidate) return null
    return normalizeSlug(candidate)
  } catch {
    return null
  }
}

async function request(
  path: string,
  options: RequestOptions = {}
): Promise<unknown> {
  const keys = await resolveKeys('opensea')
  if (keys.length === 0) {
    throw new OpenSeaError(
      0,
      'no-api-key',
      'OpenSea API key is not set. Add one in Settings.'
    )
  }

  return attempt(path, options, keys, 0, 0)
}

// A rejected key is worth retrying with the next one, but a rate limit is not a
// rejection: the same key gets its Retry-After budget first, and only a spent
// budget spends a rotation.
async function attempt(
  path: string,
  options: RequestOptions,
  keys: readonly string[],
  attemptCount: number,
  keyIndex: number
): Promise<unknown> {
  const outcome = await httpExchange(`${OPENSEA_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: {
      accept: 'application/json',
      'x-api-key': keys[keyIndex],
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (outcome.kind === 'timeout') {
    throw new OpenSeaError(
      504,
      'timeout',
      `OpenSea did not answer within ${OPENSEA_TIMEOUT_MS / 1000}s.`
    )
  }
  if (outcome.kind === 'network') {
    throw outcome.error
  }
  if (outcome.kind === 'ok') {
    return outcome.body
  }

  const nextKey = keyIndex + 1
  const hasNextKey = nextKey < keys.length
  // A signed-in request carries the wallet's bearer token, so its 401 is an
  // expired session, not a rejected API key, and spending the pool on it hides
  // the real fix.
  const keyAuth = options.headers?.authorization === undefined

  if (keyAuth && (outcome.status === 401 || outcome.status === 403)) {
    if (hasNextKey) {
      return attempt(path, options, keys, 0, nextKey)
    }
  }

  if (outcome.status === 429 || outcome.status === 503) {
    const wait = outcome.retryAfterMs
    const limit = outcome.status === 429
    const delay = wait === null ? 'shortly' : `in ${Math.ceil(wait / 1000)}s`
    const withinBudget =
      attemptCount < MAX_RETRY_ATTEMPTS &&
      (wait === null || wait <= MAX_RETRY_WAIT_MS)

    if (withinBudget) {
      await new Promise((resolve) =>
        setTimeout(resolve, wait ?? NO_HEADER_RETRY_WAIT_MS)
      )
      return attempt(path, options, keys, attemptCount + 1, keyIndex)
    }
    if (limit && keyAuth && hasNextKey) {
      return attempt(path, options, keys, 0, nextKey)
    }
    throw new OpenSeaError(
      outcome.status,
      limit ? 'rate-limited' : 'unavailable',
      limit
        ? `OpenSea rate limit reached. Try again ${delay}.`
        : `OpenSea is temporarily unavailable. Try again ${delay}.`
    )
  }

  const failure = readErrorBody(outcome.body)
  throw new OpenSeaError(
    outcome.status,
    failure.code ?? String(outcome.status),
    failure.message ?? `OpenSea request failed with ${outcome.status}`
  )
}

function unexpected(path: string) {
  return new OpenSeaError(502, 'unexpected-response', `unexpected response from ${path}`)
}

type RawCollection = {
  collection?: string
  name?: string
  image_url?: string
  total_supply?: number
  rarity?: {
    max_rank?: number
  } | null
  fees?: unknown
  pricing_currencies?: unknown
  contracts?: { address?: string; chain?: string }[]
}

const NATIVE_CURRENCY = '0x0000000000000000000000000000000000000000'

const SET_APPROVAL_FOR_ALL = '0xa22cb465'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function toCollectionFees(value: unknown): CollectionFee[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    const record = asRecord(entry)
    const percent = record?.fee
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) {
      return []
    }
    return [{ percent, required: record?.required === true }]
  })
}

function toListingCurrency(value: unknown): ListingCurrency {
  const currency = asRecord(asRecord(value)?.listing_currency)
  const address = currency?.address
  const symbol = currency?.symbol
  const decimals = currency?.decimals

  return {
    address: typeof address === 'string' && address !== '' ? address : NATIVE_CURRENCY,
    symbol: typeof symbol === 'string' && symbol !== '' ? symbol : 'ETH',
    decimals:
      typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0
        ? decimals
        : 18,
  }
}

export async function getCollection(slug: string): Promise<CollectionInfo> {
  const body = (await request(`/collections/${encodeURIComponent(slug)}`)) as RawCollection
  const contract = body?.contracts?.[0]

  if (!contract?.address || !contract.chain) {
    throw unexpected('/collections')
  }

  const maxRank = body.rarity?.max_rank
  return {
    slug: body.collection ?? slug,
    name: body.name ?? '',
    chain: contract.chain,
    contractAddress: contract.address,
    imageUrl: body.image_url ?? '',
    totalSupply:
      typeof body.total_supply === 'number' && Number.isFinite(body.total_supply)
        ? body.total_supply
        : null,
    rarity:
      typeof maxRank === 'number' && Number.isInteger(maxRank) && maxRank > 0
        ? {
            maxRank,
          }
        : null,
    fees: toCollectionFees(body.fees),
    listingCurrency: toListingCurrency(body.pricing_currencies),
  }
}

type RawCollectionStats = {
  total?: {
    floor_price?: number
    floor_price_symbol?: string
  } | null
}

export async function getCollectionStats(slug: string): Promise<CollectionStats> {
  const body = (await request(
    `/collections/${encodeURIComponent(slug)}/stats`
  )) as RawCollectionStats | null

  if (!body?.total || typeof body.total !== 'object') {
    throw unexpected('/collections/stats')
  }

  const floor = body.total.floor_price
  const floorPrice =
    typeof floor === 'number' && Number.isFinite(floor) && floor > 0 ? floor : null
  const symbol = body.total.floor_price_symbol

  return {
    floorPrice,
    floorSymbol:
      floorPrice !== null && typeof symbol === 'string' ? symbol : '',
  }
}

type RawAccountNft = {
  contract?: string
  identifier?: string
  name?: string
  display_image_url?: string
  image_url?: string
  opensea_url?: string
  quantity?: number
  quantity_string?: string
  decimals?: number | null
}

export async function getAccountNfts(input: {
  chain: string
  address: string
  slug: string
  cursor?: string
  limit?: number
}): Promise<AccountNftPage> {
  const requested = input.limit ?? 200
  const limit = Number.isFinite(requested)
    ? Math.min(200, Math.max(1, Math.trunc(requested)))
    : 200
  const params = new URLSearchParams({
    collection: input.slug,
    limit: String(limit),
  })
  if (input.cursor) params.set('next', input.cursor)

  const body = (await request(
    `/chain/${encodeURIComponent(input.chain)}/account/${encodeURIComponent(input.address)}/nfts?${params.toString()}`
  )) as { nfts?: RawAccountNft[]; next?: string | null } | null

  if (!Array.isArray(body?.nfts)) {
    throw unexpected('/chain/account/nfts')
  }

  return {
    nfts: body.nfts.flatMap((raw) => {
      if (typeof raw.identifier !== 'string' || raw.identifier === '') return []
      const rawQuantity = Number(raw.quantity_string ?? raw.quantity ?? 1)
      const decimals =
        typeof raw.decimals === 'number' &&
        Number.isInteger(raw.decimals) &&
        raw.decimals > 0
          ? raw.decimals
          : 0
      const quantity =
        Number.isFinite(rawQuantity) && rawQuantity > 0
          ? rawQuantity / 10 ** decimals
          : 1

      return [
        {
          chain: input.chain,
          contractAddress: raw.contract ?? '',
          tokenId: raw.identifier,
          name: raw.name ?? '',
          imageUrl: raw.display_image_url ?? raw.image_url ?? '',
          openseaUrl: raw.opensea_url ?? '',
          quantity,
          decimals,
        },
      ]
    }),
    next: typeof body.next === 'string' && body.next !== '' ? body.next : null,
  }
}

type RawBatchNft = {
  identifier?: string
  rarity?: { rank?: number | null } | null
}

export async function getNftRankBatch(input: {
  chain: string
  contractAddress: string
  tokenIds: readonly string[]
}): Promise<NftRank[]> {
  if (input.tokenIds.length > NFT_BATCH_MAX) {
    throw new RangeError(`NFT batch limit is ${NFT_BATCH_MAX} identifiers`)
  }

  const body = (await request('/nfts/batch', {
    method: 'POST',
    body: JSON.stringify({
      identifiers: input.tokenIds.map((tokenId) => ({
        chain: input.chain,
        contract_address: input.contractAddress,
        token_id: tokenId,
      })),
    }),
  })) as { nfts?: RawBatchNft[] } | null

  if (!Array.isArray(body?.nfts)) {
    throw unexpected('/nfts/batch')
  }

  return body.nfts.flatMap((raw) => {
    if (typeof raw.identifier !== 'string' || raw.identifier === '') return []
    const candidate = raw.rarity?.rank
    const rank =
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate > 0
        ? candidate
        : null

    return [{ tokenId: raw.identifier, rank }]
  })
}

type RawStage = {
  uuid?: string
  stage_uuid?: string
  stage_type?: string
  label?: string
  price?: string
  max_per_wallet?: string
  start_time?: string
  end_time?: string
}

type RawDrop = {
  collection_slug?: string
  collection_name?: string
  chain?: string
  contract_address?: string
  drop_type?: string
  is_minting?: boolean
  max_supply?: string
  total_supply?: string
  active_stage?: RawStage | null
  next_stage?: RawStage | null
  stages?: RawStage[]
}

function toStage(raw: RawStage | null | undefined): DropStage | null {
  if (!raw) {
    return null
  }

  return {
    uuid: raw.uuid ?? raw.stage_uuid ?? '',
    stageType: raw.stage_type ?? '',
    label: raw.label ?? '',
    priceWei: raw.price ?? '0',
    maxPerWallet: raw.max_per_wallet ?? '0',
    startTime: raw.start_time ?? '',
    endTime: raw.end_time ?? '',
  }
}

// `stages` arrives in storage order, not chronological order: the public stage
// is stored first even when it opens last. Sort by start time so the schedule
// reads in the order it happens, and park stages with no start time at the end.
export function byStageStart(a: DropStage, b: DropStage): number {
  if (!a.startTime) return b.startTime ? 1 : 0
  if (!b.startTime) return -1
  const left = Date.parse(a.startTime)
  const right = Date.parse(b.startTime)
  if (Number.isNaN(left) || Number.isNaN(right)) return 0
  return left - right
}

export async function getDrop(slug: string): Promise<DropInfo> {
  const body = (await request(`/drops/${encodeURIComponent(slug)}`)) as RawDrop

  if (!body?.contract_address || !body.chain) {
    throw unexpected('/drops')
  }

  const drop: DropInfo = {
    slug: body.collection_slug ?? slug,
    name: body.collection_name ?? '',
    chain: body.chain,
    contractAddress: body.contract_address,
    dropType: body.drop_type ?? '',
    isMinting: body.is_minting === true,
    maxSupply: body.max_supply ?? '0',
    totalSupply: body.total_supply ?? '0',
    activeStage: toStage(body.active_stage),
    nextStage: toStage(body.next_stage),
    stages: (body.stages ?? [])
      .flatMap((stage) => {
        const mapped = toStage(stage)
        return mapped ? [mapped] : []
      })
      .sort(byStageStart),
  }
  traceMint({
    kind: 'drops',
    slug: drop.slug,
    activeStageUuid: drop.activeStage?.uuid ?? null,
  })
  return drop
}

type RawStageEligibility = {
  stage_uuid?: string
  is_eligible?: boolean
  max_total_mintable_by_wallet?: string | null
  price?: string
}

export async function getEligibility(
  slug: string,
  token: string
): Promise<EligibilityResponse> {
  const body = (await request(`/drops/${encodeURIComponent(slug)}/eligibility`, {
    headers: { authorization: `Bearer ${token}` },
  })) as { stages?: RawStageEligibility[] } | null

  if (!Array.isArray(body?.stages)) {
    throw unexpected('/drops/eligibility')
  }

  return {
    stages: body.stages.map((stage) => ({
      stageUuid: stage.stage_uuid ?? '',
      eligible: stage.is_eligible === true,
      maxMintable: stage.max_total_mintable_by_wallet ?? '0',
      priceWei: stage.price ?? '0',
    })),
  }
}

export async function buildMintTransaction(
  slug: string,
  minter: string,
  quantity: number
): Promise<MintTransaction> {
  const body = (await request(`/drops/${encodeURIComponent(slug)}/mint`, {
    method: 'POST',
    body: JSON.stringify({ minter, quantity }),
  })) as Partial<MintTransaction> | null

  if (!body?.chain || !body.to || !body.data || body.value === undefined) {
    throw unexpected('/drops/mint')
  }

  const transaction: MintTransaction = {
    chain: body.chain,
    to: body.to,
    data: body.data,
    value: body.value,
  }
  traceMint({ kind: 'calldata', slug, minter, quantity })
  return transaction
}

export type ListingActionItem = {
  contract: string
  tokenId: string
  quantity: number
}

export type ListingActionEnvelope =
  | {
      kind: 'approval'
      chainId: number
      from: string
      to: `0x${string}`
      data: `0x${string}`
      value: string
      token: { contract: string; tokenId: string }
    }
  | {
      kind: 'listings'
      chainId: number
      protocolAddress: string
      typedData: { primaryType: unknown; domain: unknown; message: unknown }
      tokens: { contract: string; tokenId: string }[]
    }

function unwrapValue(value: unknown): unknown {
  const record = asRecord(value)
  return record && 'value' in record ? record.value : value
}

function requiredString(value: unknown, field: string): string {
  const unwrapped = unwrapValue(value)
  if (typeof unwrapped !== 'string' || unwrapped === '') {
    throw new OpenSeaError(
      502,
      'unexpected-response',
      `listing actions are missing ${field}`
    )
  }
  return unwrapped
}

function requiredAddress(value: unknown, field: string): `0x${string}` {
  const unwrapped = unwrapValue(value)
  if (typeof unwrapped !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(unwrapped)) {
    throw new OpenSeaError(
      502,
      'unexpected-response',
      `listing actions are missing ${field}`
    )
  }
  return unwrapped as `0x${string}`
}

function requiredData(value: unknown, field: string): `0x${string}` {
  const unwrapped = unwrapValue(value)
  if (typeof unwrapped !== 'string' || !/^0x([0-9a-fA-F]{2})+$/.test(unwrapped)) {
    throw new OpenSeaError(
      502,
      'unexpected-response',
      `listing actions are missing ${field}`
    )
  }
  return unwrapped as `0x${string}`
}

function requiredChainId(value: unknown): number {
  const chainId = asRecord(value)?.chainId
  if (typeof chainId !== 'number' || !Number.isInteger(chainId)) {
    throw new OpenSeaError(
      502,
      'unexpected-response',
      'listing actions are missing the chain id'
    )
  }
  return chainId
}

function toListingEnvelope(step: unknown): ListingActionEnvelope {
  const record = asRecord(step)

  const approval = asRecord(record?.itemApprovalAction)
  if (approval) {
    const transaction = asRecord(approval.transaction)
    const asset = asRecord(approval.assetIdentifier)
    const to = requiredAddress(transaction?.to, 'the approval target')
    const data = requiredData(transaction?.data, 'the approval data')
    const value = requiredString(transaction?.value, 'the approval value')
    const contract = requiredString(asset?.contractAddress, 'the approval contract')

    // The wallet signs this with its own key, so the shape is checked against
    // the one approval a listing needs: setApprovalForAll on the collection the
    // token belongs to, free of charge.
    if (
      to.toLowerCase() !== contract.toLowerCase() ||
      !data.startsWith(SET_APPROVAL_FOR_ALL) ||
      value !== '0'
    ) {
      throw unexpected('/listings/actions')
    }

    return {
      kind: 'approval',
      chainId: requiredChainId(transaction?.chainIdentifier),
      from: requiredString(transaction?.from, 'the approval sender'),
      to,
      data,
      value,
      token: {
        contract,
        tokenId: requiredString(asset?.tokenId, 'the approval token id'),
      },
    }
  }

  const listings = asRecord(record?.createListingsAction)
  if (listings) {
    const signatureRequest = asRecord(listings.signatureRequest)
    const encoded = signatureRequest?.message
    if (typeof encoded !== 'string' || encoded === '') {
      throw unexpected('/listings/actions')
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(encoded)
    } catch {
      throw unexpected('/listings/actions')
    }

    const typedData = asRecord(decoded)
    if (!typedData || typedData.message === undefined) {
      throw unexpected('/listings/actions')
    }

    const orders = Array.isArray(listings.orders) ? listings.orders : []
    const assets = Array.isArray(listings.assetIdentifiers)
      ? listings.assetIdentifiers
      : []

    return {
      kind: 'listings',
      chainId: requiredChainId(signatureRequest?.chainIdentifier),
      protocolAddress: requiredString(
        asRecord(orders[0])?.protocolAddress,
        'the protocol address'
      ),
      typedData: {
        primaryType: typedData.primaryType,
        domain: typedData.domain,
        message: typedData.message,
      },
      tokens: assets.map((entry) => {
        const asset = asRecord(entry)
        return {
          contract: requiredString(asset?.contractAddress, 'an asset contract'),
          tokenId: requiredString(asset?.tokenId, 'an asset token id'),
        }
      }),
    }
  }

  throw unexpected('/listings/actions')
}

export async function requestListingActions(input: {
  address: string
  chain: string
  priceAmount: bigint
  currency: string
  decimals: number
  endTimeSec: number
  items: readonly ListingActionItem[]
}): Promise<ListingActionEnvelope[]> {
  const endTime = new Date(input.endTimeSec * 1000).toISOString()
  const body = (await request('/listings/actions', {
    method: 'POST',
    body: JSON.stringify({
      address: input.address,
      items: input.items.map((item) => ({
        chain: input.chain,
        contract: item.contract,
        token_id: item.tokenId,
        quantity: item.quantity,
        price: {
          amount: formatUnits(input.priceAmount, input.decimals),
          currency: input.currency,
        },
        end_time: endTime,
      })),
    }),
  })) as { steps?: unknown } | null

  if (!Array.isArray(body?.steps)) {
    throw unexpected('/listings/actions')
  }

  return body.steps.map(toListingEnvelope)
}

export async function submitListingOrder(input: {
  chain: string
  protocolAddress: string
  parameters: SeaportParameters
  signature: string
}): Promise<{ orderHash: string | null }> {
  const body = (await request(
    `/orders/${encodeURIComponent(input.chain)}/seaport/listings`,
    {
      method: 'POST',
      body: JSON.stringify({
        parameters: input.parameters,
        protocol_address: input.protocolAddress,
        signature: input.signature,
      }),
    }
  )) as { order_hash?: unknown } | null

  return {
    orderHash: typeof body?.order_hash === 'string' ? body.order_hash : null,
  }
}

const OFFER_PAGE_LIMIT = 200
const OFFER_PAGE_CAP = 5
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const ORDER_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/
const CALLDATA_SUFFIX_PATTERN = /^0x([0-9a-fA-F]{2})+$/

// The REST order serialises uint fields in shapes the signer's leaf parser does
// not read: counter is an integer and salt can be hex. Normalise those two.
function offerParameters(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  if (!record) return null

  const counter = record.counter
  const salt = record.salt
  return {
    ...record,
    counter:
      typeof counter === 'number'
        ? String(counter)
        : typeof counter === 'string' && /^0x[0-9a-fA-F]+$/.test(counter)
          ? BigInt(counter).toString()
          : counter,
    salt:
      typeof salt === 'string' && /^0x[0-9a-fA-F]+$/.test(salt)
        ? BigInt(salt).toString()
        : salt,
  }
}

function toCollectionOffer(
  raw: unknown,
  chain: string
): CollectionOffer | null {
  const record = asRecord(raw)
  if (!record || record.status !== 'ACTIVE' || record.chain !== chain) {
    return null
  }

  const orderHash = record.order_hash
  const protocolAddress = record.protocol_address
  const remainingQuantity = record.remaining_quantity
  if (
    typeof orderHash !== 'string' ||
    !ORDER_HASH_PATTERN.test(orderHash) ||
    typeof protocolAddress !== 'string' ||
    !ADDRESS_PATTERN.test(protocolAddress) ||
    typeof remainingQuantity !== 'number' ||
    !Number.isInteger(remainingQuantity) ||
    remainingQuantity < 1
  ) {
    return null
  }

  // A null criteria is a single-item offer, not a bid against any token.
  const criteria = asRecord(record.criteria)
  if (!criteria) return null

  for (const field of ['traits', 'numeric_traits']) {
    const filter = criteria[field]
    if (filter === null || filter === undefined) continue
    if (!Array.isArray(filter) || filter.length > 0) return null
  }
  const encoded = criteria.encoded_token_ids
  if (encoded !== null && encoded !== undefined && encoded !== '') {
    return null
  }

  let leaf: OrderComponentsLeaf | null = null
  try {
    const parameters = offerParameters(
      asRecord(record.protocol_data)?.parameters
    )
    if (parameters) {
      leaf = parseOrderComponents(parameters)
    }
  } catch {
    return null
  }
  if (!leaf) return null

  const price =
    asRecord(record.price_per_item) ?? asRecord(record.price)
  const symbol = price?.currency
  const decimals = price?.decimals
  if (
    typeof symbol !== 'string' ||
    symbol === '' ||
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0
  ) {
    return null
  }

  const economics = offerEconomics({
    leaf,
    remaining: remainingQuantity,
    currency: { symbol, decimals },
  })
  if (!economics) return null

  return {
    id: orderHash.toLowerCase(),
    chain,
    protocolAddress: protocolAddress.toLowerCase() as `0x${string}`,
    currency: economics.currency,
    grossWei: economics.grossWei,
    feeWei: economics.feeWei,
    netWei: economics.netWei,
    remaining: remainingQuantity,
    expiresAtSec: economics.expiresAtSec,
    parameters: leaf,
  }
}

export async function getCollectionOffers(input: {
  slug: string
  chain: string
}): Promise<{ offers: CollectionOffer[]; truncated: boolean }> {
  const offers: CollectionOffer[] = []
  let cursor: string | null = null
  let pages = 0

  do {
    const params = new URLSearchParams({ limit: String(OFFER_PAGE_LIMIT) })
    if (cursor) params.set('next', cursor)

    const body = (await request(
      `/offers/collection/${encodeURIComponent(input.slug)}?${params.toString()}`
    )) as { offers?: unknown; next?: unknown } | null

    const rawOffers = body?.offers
    const next = body?.next
    if (!Array.isArray(rawOffers)) {
      throw unexpected('/offers/collection')
    }

    for (const raw of rawOffers) {
      const offer = toCollectionOffer(raw, input.chain)
      if (offer) offers.push(offer)
    }

    cursor = typeof next === 'string' && next !== '' ? next : null
    pages += 1
  } while (cursor && pages < OFFER_PAGE_CAP)

  return { offers, truncated: cursor !== null }
}

export async function requestOfferFulfillment(input: {
  offer: CollectionOffer
  fulfiller: string
  contract: string
  tokenId: string
}): Promise<OfferFulfillmentTransaction> {
  const body = (await request('/offers/fulfillment_data', {
    method: 'POST',
    body: JSON.stringify({
      offer: {
        hash: input.offer.id,
        chain: input.offer.chain,
        protocol_address: input.offer.protocolAddress,
      },
      fulfiller: { address: input.fulfiller },
      consideration: {
        asset_contract_address: input.contract,
        token_id: input.tokenId,
      },
      units_to_fill: '1',
      include_optional_creator_fees: false,
    }),
  })) as { fulfillment_data?: unknown } | null

  const transaction = asRecord(asRecord(body?.fulfillment_data)?.transaction)
  if (!transaction) throw unexpected('/offers/fulfillment_data')

  const chainId = transaction.chain
  const to = transaction.to
  const rawValue = transaction.value
  const value =
    typeof rawValue === 'string' && /^0x[0-9a-fA-F]+$/.test(rawValue)
      ? BigInt(rawValue).toString()
      : rawValue
  const fn = transaction.function
  const rawInputData = asRecord(transaction.input_data)
  const inputData =
    rawInputData && !Array.isArray(rawInputData) ? rawInputData : null
  const suffix = transaction.calldata_suffix

  if (
    typeof chainId !== 'number' ||
    !Number.isInteger(chainId) ||
    typeof to !== 'string' ||
    !ADDRESS_PATTERN.test(to) ||
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    typeof fn !== 'string' ||
    fn === '' ||
    !inputData ||
    (suffix !== null &&
      suffix !== undefined &&
      (typeof suffix !== 'string' || !CALLDATA_SUFFIX_PATTERN.test(suffix)))
  ) {
    throw unexpected('/offers/fulfillment_data')
  }

  const open = fn.indexOf('(')
  return {
    chainId,
    to: to as `0x${string}`,
    value,
    functionName: open === -1 ? fn : fn.slice(0, open),
    inputData,
    calldataSuffix:
      typeof suffix === 'string' ? (suffix as `0x${string}`) : null,
  }
}
