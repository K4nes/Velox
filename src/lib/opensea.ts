import { OPENSEA_BASE_URL, OPENSEA_TIMEOUT_MS, httpExchange, readErrorBody } from '@/lib/http'
import { readSecret } from '@/lib/secrets'

const MAX_RETRY_ATTEMPTS = 2
const MAX_RETRY_WAIT_MS = 30_000

export class OpenSeaError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'OpenSeaError'
    this.status = status
    this.code = code
  }
}

// measured 2026-11-03: 91 identifiers -> 400 "identifiers must not exceed 30 items"
export const NFT_BATCH_MAX = 30

export type RarityIndex = {
  maxRank: number
}

export type CollectionInfo = {
  slug: string
  name: string
  chain: string
  contractAddress: string
  imageUrl: string
  totalSupply: number | null
  rarity: RarityIndex | null
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
  options: RequestOptions = {},
  attempt = 0
): Promise<unknown> {
  const apiKey = await readSecret('opensea-api-key')
  if (!apiKey) {
    throw new OpenSeaError(
      0,
      'no-api-key',
      'OpenSea API key is not set. Add one in Settings.'
    )
  }

  const outcome = await httpExchange(`${OPENSEA_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
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

  if (outcome.status === 429 || outcome.status === 503) {
    const wait = outcome.retryAfterMs
    const limit = outcome.status === 429
    if (
      attempt >= MAX_RETRY_ATTEMPTS ||
      (wait !== null && wait > MAX_RETRY_WAIT_MS)
    ) {
      const delay = wait === null ? 'shortly' : `in ${Math.ceil(wait / 1000)}s`
      throw new OpenSeaError(
        outcome.status,
        limit ? 'rate-limited' : 'unavailable',
        limit
          ? `OpenSea rate limit reached. Try again ${delay}.`
          : `OpenSea is temporarily unavailable. Try again ${delay}.`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, wait ?? 2000))
    return request(path, options, attempt + 1)
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
    strategy_id?: string
    strategy_version?: string
  } | null
  contracts?: { address?: string; chain?: string }[]
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
      const quantity = raw.quantity ?? 1

      return [
        {
          chain: input.chain,
          contractAddress: raw.contract ?? '',
          tokenId: raw.identifier,
          name: raw.name ?? '',
          imageUrl: raw.display_image_url ?? raw.image_url ?? '',
          openseaUrl: raw.opensea_url ?? '',
          quantity:
            Number.isInteger(quantity) && quantity >= 1 ? quantity : 1,
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

  return {
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

  return { chain: body.chain, to: body.to, data: body.data, value: body.value }
}
