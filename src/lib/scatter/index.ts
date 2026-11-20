import { SCATTER_TIMEOUT_MS, httpExchange, readErrorBody } from '@/lib/chain/http'
import {
  ERC20_REFUSAL_CODE,
  unreadableAllowanceRefusal,
  unresolvedSpenderRefusal,
} from '@/lib/scatter/erc20-refusal'
import type { MintAllowance } from '@/lib/mint/allowance'
import type { DropStage } from '@/lib/opensea/index'
import { ScatterError } from '@/lib/scatter/error'

const SCATTER_BASE_URL = 'https://api.scatter.art/v1'

// Scatter reports `0xffffffff` for "no end" and "no limit". Left raw, an end time
// becomes an expiry a century out and a limit becomes a nine-digit number in the
// quantity field, so the client normalises both once, here.
const UINT32_MAX = 0xffffffff

export type ScatterCollection = {
  name: string
  address: string
  chainId: number
  maxItems: number
  numItems: number
}

export type ScatterMintList = {
  id: string
  name: string
  currencyAddress: string
  currencySymbol: string
  // A decimal amount, not base units; `decimals` turns it into wei.
  tokenPrice: string
  decimals: number
  startTime: string
  // Empty when the list has no end.
  endTime: string
  // Null when the list states no limit.
  walletLimit: number | null
  unitSize: number
}

async function request(
  path: string,
  init: { method?: string; body?: string } = {}
): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
  }

  const outcome = await httpExchange(`${SCATTER_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body,
    timeoutMs: SCATTER_TIMEOUT_MS,
  })

  if (outcome.kind === 'timeout') {
    throw new ScatterError(
      504,
      'timeout',
      `Scatter did not answer within ${SCATTER_TIMEOUT_MS / 1000}s.`
    )
  }
  if (outcome.kind === 'network') {
    throw outcome.error
  }
  if (outcome.kind === 'ok') {
    return outcome.body
  }

  const failure = readErrorBody(outcome.body)
  throw new ScatterError(
    outcome.status,
    failure.code ?? String(outcome.status),
    failure.message ?? `Scatter request failed with ${outcome.status}`
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function unexpected(path: string): ScatterError {
  return new ScatterError(
    502,
    'unexpected-response',
    `unexpected response from Scatter ${path}`
  )
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function isoTime(value: unknown): string {
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) return ''
    return Math.floor(ms / 1000) >= UINT32_MAX ? '' : value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < UINT32_MAX
      ? new Date(value * 1000).toISOString()
      : ''
  }
  return ''
}

function statedLimit(value: unknown): number | null {
  const number = finiteNumber(value)
  if (number === null || number < 0 || number >= UINT32_MAX) return null
  return Math.round(number)
}

export async function getScatterCollection(
  slug: string
): Promise<ScatterCollection> {
  const body = await request(`/collection/${encodeURIComponent(slug)}`)
  const record = asRecord(body)
  const address = record?.address
  const chainId = finiteNumber(record?.chain_id)

  if (typeof address !== 'string' || address === '' || chainId === null) {
    throw unexpected(`/collection/${slug}`)
  }

  return {
    name: String(record?.name ?? ''),
    address,
    chainId,
    maxItems: finiteNumber(record?.max_items) ?? 0,
    numItems: finiteNumber(record?.num_items) ?? 0,
  }
}

// Without `minterAddress` the answer is the collection's lists. With it, Scatter
// narrows the answer to the lists that wallet can enter, which is the eligibility
// read the check uses.
export async function getScatterMintLists(
  slug: string,
  minterAddress?: string
): Promise<ScatterMintList[]> {
  const query = minterAddress
    ? `?minterAddress=${encodeURIComponent(minterAddress)}`
    : ''
  const body = await request(
    `/collection/${encodeURIComponent(slug)}/eligible-invite-lists${query}`
  )
  if (!Array.isArray(body)) {
    throw unexpected(`/collection/${slug}/eligible-invite-lists`)
  }

  return body.map(toMintList)
}

export function toMintList(value: unknown): ScatterMintList {
  const record = asRecord(value)
  const id = record?.id
  if (id === undefined || id === null || String(id) === '') {
    throw unexpected('/eligible-invite-lists')
  }

  return {
    id: String(id),
    name: String(record?.name ?? ''),
    currencyAddress: String(record?.currency_address ?? '').toLowerCase(),
    currencySymbol: String(record?.currency_symbol ?? ''),
    tokenPrice: String(record?.token_price ?? '0'),
    // Scatter states the decimals with the price; 18 is the chain default if a list
    // omits it, not a guess about the currency.
    decimals: finiteNumber(record?.decimals) ?? 18,
    startTime: isoTime(record?.start_time),
    endTime: isoTime(record?.end_time),
    walletLimit: statedLimit(record?.wallet_limit),
    unitSize: Math.max(1, statedLimit(record?.unit_size) ?? 1),
  }
}

export type ScatterMintBuild = {
  to: string
  data: string
  value: string
  allowances: MintAllowance[]
}

export type ScatterMintRequest = {
  collectionAddress: string
  chainId: number
  minterAddress: string
  listId: string
  quantity: number
  // The ERC-1155 edition. Empty for an ERC-721, and the list entry omits it then.
  tokenId: string
}

type BuildPayment = {
  currencyAddress: string
  currencySymbol: unknown
  currencyDecimals: unknown
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function toBuildPayments(value: unknown): BuildPayment[] {
  if (!Array.isArray(value)) return []
  const payments: BuildPayment[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const address = record?.currencyAddress
    if (typeof address !== 'string') continue
    payments.push({
      currencyAddress: address,
      currencySymbol: record?.currencySymbol,
      currencyDecimals: record?.currencyDecimals,
    })
  }
  return payments
}

// The answer is parsed apart from the request, so a recorded upstream body can be run
// through it without a network. The allowance list is read first and fails closed: an
// answer whose allowance shape cannot be resolved refuses before the caller sees a
// transaction to sign. A native answer carries no allowance and no extra work.
export function toScatterMintBuild(
  body: unknown,
  context: { stage?: DropStage | null; collectionAddress?: string } = {}
): ScatterMintBuild {
  const record = asRecord(body)

  const allowances = toAllowances(
    record?.erc20s,
    context,
    toBuildPayments(record?.listPayments)
  )

  const transaction = asRecord(record?.mintTransaction)
  const to = transaction?.to
  const data = transaction?.data
  const value = transaction?.value
  if (
    typeof to !== 'string' ||
    to === '' ||
    typeof data !== 'string' ||
    data === '' ||
    value === undefined ||
    value === null
  ) {
    throw unexpected('/mint')
  }

  return { to, data, value: String(value), allowances }
}

// Sends one build for one list and hands the answer to the parser above, which resolves
// the allowance list before any caller sees a transaction to sign.
export async function buildScatterMintTransaction(
  input: ScatterMintRequest,
  stage: DropStage | null = null
): Promise<ScatterMintBuild> {
  const tokenId = scatterListTokenId(input.tokenId)
  const body = await request('/mint', {
    method: 'POST',
    body: JSON.stringify({
      collectionAddress: input.collectionAddress,
      chainId: input.chainId,
      minterAddress: input.minterAddress,
      lists: [
        {
          id: input.listId,
          quantity: input.quantity,
          ...(tokenId !== undefined ? { tokenId } : {}),
        },
      ],
    }),
  })

  return toScatterMintBuild(body, {
    stage,
    collectionAddress: input.collectionAddress,
  })
}

// Scatter states the token inside the list entry, not at the top level. An empty ID
// is an ERC-721 build, and the key must be absent then, not zero.
function scatterListTokenId(tokenId: string): number | undefined {
  if (tokenId === '') return undefined
  if (!/^\d+$/.test(tokenId)) {
    throw new ScatterError(
      422,
      'invalid-token-id',
      `Scatter token ID "${tokenId}" is not a number.`
    )
  }
  const value = Number(tokenId)
  if (!Number.isSafeInteger(value)) {
    throw new ScatterError(
      422,
      'invalid-token-id',
      `Scatter token ID "${tokenId}" is outside the range Velox can send.`
    )
  }
  return value
}

// An absent allowance list is a native-currency mint. Anything else this cannot resolve
// is an allowance rather than an absence: the refusal exists to stop that mint, and
// guessing wrong signs a mint the wallet is not funded for.
function toAllowances(
  value: unknown,
  context: { stage?: DropStage | null; collectionAddress?: string },
  payments: BuildPayment[]
): MintAllowance[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw unreadableAllowances()

  const stage = context.stage ?? null
  const entries: Omit<MintAllowance, 'spender'>[] = value.map((entry) => {
    const record = asRecord(entry)
    const address = record?.address
    const amount = record?.amount
    if (
      typeof address !== 'string' ||
      !ADDRESS.test(address) ||
      amount === undefined ||
      amount === null ||
      !/^\d+$/.test(String(amount))
    ) {
      throw unreadableAllowances()
    }

    const token = address as `0x${string}`
    const payment = payments.find(
      (candidate) =>
        candidate.currencyAddress.toLowerCase() === token.toLowerCase()
    )
    const currency = stage?.currency
    const resolved: Omit<MintAllowance, 'spender'> = {
      token,
      amount: BigInt(String(amount)),
    }
    if (
      payment !== undefined &&
      typeof payment.currencySymbol === 'string' &&
      payment.currencySymbol !== '' &&
      typeof payment.currencyDecimals === 'number' &&
      Number.isInteger(payment.currencyDecimals) &&
      payment.currencyDecimals >= 0
    ) {
      resolved.symbol = payment.currencySymbol
      resolved.decimals = payment.currencyDecimals
    } else if (
      currency !== undefined &&
      currency.address.toLowerCase() === token.toLowerCase() &&
      currency.symbol !== ''
    ) {
      resolved.symbol = currency.symbol
      resolved.decimals = currency.decimals
    }
    return resolved
  })

  // The spender is the collection, pinned by the recorded build. The mint transaction's
  // target may differ, so it is never used as the spender. Without a collection address
  // there is no safe target and the build is refused rather than guessed.
  const collection = context.collectionAddress
  if (
    entries.length > 0 &&
    (typeof collection !== 'string' || !ADDRESS.test(collection))
  ) {
    throw new ScatterError(422, ERC20_REFUSAL_CODE, unresolvedSpenderRefusal())
  }

  return entries.map((entry) => ({
    ...entry,
    spender: collection as `0x${string}`,
  }))
}

function unreadableAllowances(): ScatterError {
  return new ScatterError(
    422,
    ERC20_REFUSAL_CODE,
    unreadableAllowanceRefusal()
  )
}
