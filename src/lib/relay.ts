import { chainByChainId, chainBySlug } from '@/config/chains'
import type { ChainSlug } from '@/config/chains'
import { relayCurrency } from '@/config/swap-assets'
import { httpExchange } from '@/lib/http'
import type { SwapSpec } from '@/lib/swap-spec'

export type SwapOperation = 'wrap' | 'unwrap' | 'swap'

export type SwapTx = {
  readonly chain: ChainSlug
  readonly to: `0x${string}`
  readonly data: `0x${string}`
  readonly value: bigint
}

// `indexing` is what this step owes the indexer: a wrap/unwrap never touches a
// Relay contract and a cross-chain deposit needs its internal trace indexed.
// `awaitsStatus` is whether Relay gave this step a status endpoint to poll.
export type SwapTxStep = {
  readonly purpose: 'approve' | 'execute'
  readonly tx: SwapTx
  readonly indexing: 'single' | 'deposit' | 'none'
  readonly awaitsStatus: boolean
  readonly label: string
}

export type SwapQuote = {
  readonly requestId: string
  readonly operation: SwapOperation
  readonly amountOut: bigint
  readonly minimumOut: bigint
  readonly steps: readonly SwapTxStep[]
}

export type SwapIntentStatus =
  | { readonly kind: 'pending'; readonly status: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'success' }
  | { readonly kind: 'refund'; readonly reason: string | null }
  | { readonly kind: 'stuck'; readonly reason: string }

class RelayError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(
    message: string,
    options: { code: string; status?: number | null }
  ) {
    super(message)
    this.name = 'RelayError'
    this.code = options.code
    this.status = options.status ?? null
  }
}

const RELAY_API = 'https://api.relay.link'
const QUOTE_PATH = '/quote/v2'
const STATUS_PATH = '/intents/status/v3'
const SINGLE_PATH = '/transactions/single'
const INDEX_PATH = '/transactions/index'

// The SDK's default cadence is 5 s over 30 attempts; a shorter interval still
// fits a 150 s budget with room for a few transient failures.
const POLL_INTERVAL_MS = 4_000
const POLL_BUDGET_MS = 150_000
const INDEX_ATTEMPTS = 2
// The notify posts at most twice, so this is the only wait it adds, and it keeps
// the second attempt from firing in the same instant as the first.
const INDEX_RETRY_WAIT_MS = 1_000

function unexpected(message: string): RelayError {
  return new RelayError(message, { code: 'unexpected-response' })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asHex(value: unknown): `0x${string}` | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)
    ? (value as `0x${string}`)
    : null
}

function asAddress(value: unknown): `0x${string}` | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as `0x${string}`)
    : null
}

function asBigInt(value: unknown): bigint | null {
  return typeof value === 'string' && /^\d+$/.test(value)
    ? BigInt(value)
    : null
}

function errorFromBody(body: unknown, status: number): RelayError {
  const source = asRecord(body)
  const message =
    asString(source?.message) ?? `Relay returned HTTP ${status}`
  const code = asString(source?.errorCode) ?? 'http-error'
  return new RelayError(message, { code, status })
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const outcome = await httpExchange(`${RELAY_API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (outcome.kind === 'ok') return outcome.body
  if (outcome.kind === 'status') {
    throw errorFromBody(outcome.body, outcome.status)
  }
  if (outcome.kind === 'timeout') {
    throw new RelayError('Relay did not answer in time', { code: 'timeout' })
  }
  throw new RelayError('Relay could not be reached', { code: 'network' })
}

async function getJson(path: string): Promise<unknown> {
  const outcome = await httpExchange(`${RELAY_API}${path}`)

  if (outcome.kind === 'ok') return outcome.body
  if (outcome.kind === 'status') {
    throw errorFromBody(outcome.body, outcome.status)
  }
  if (outcome.kind === 'timeout') {
    throw new RelayError('Relay did not answer in time', { code: 'timeout' })
  }
  throw new RelayError('Relay could not be reached', { code: 'network' })
}

function stepLabel(
  id: string,
  operation: SwapOperation,
  spec: SwapSpec
): string {
  if (id === 'approve') return `approval of ${spec.from.symbol}`
  if (id === 'deposit') {
    const chain = chainBySlug(spec.to.chain)
    return `deposit to ${chain?.name ?? spec.to.chain}`
  }
  if (operation === 'wrap') return `wrap to ${spec.to.symbol}`
  if (operation === 'unwrap') return `unwrap to ${spec.to.symbol}`
  return `swap ${spec.from.symbol} for ${spec.to.symbol}`
}

function parseStep(
  raw: unknown,
  operation: SwapOperation,
  spec: SwapSpec
): SwapTxStep {
  const step = asRecord(raw)
  if (!step) throw unexpected('Quote step is not an object')

  const kind = asString(step.kind)
  if (kind === 'signature') {
    throw new RelayError(
      'Relay returned a signature step, which this page does not support',
      { code: 'unsupported-signature-step' }
    )
  }
  if (kind !== 'transaction') {
    throw new RelayError(`Unsupported step kind: ${String(step.kind)}`, {
      code: 'unsupported-step',
    })
  }

  const id = asString(step.id)
  if (!id) throw unexpected('Quote step has no id')

  const purpose =
    id === 'approve'
      ? ('approve' as const)
      : id === 'swap' || id === 'deposit'
        ? ('execute' as const)
        : null
  if (!purpose) {
    throw new RelayError(`Unsupported step: ${id}`, {
      code: 'unsupported-step',
    })
  }

  const items = step.items
  if (!Array.isArray(items) || items.length !== 1) {
    throw new RelayError(`Step ${id} does not carry exactly one item`, {
      code: 'unsupported-step',
    })
  }

  const item = asRecord(items[0])
  const data = asRecord(item?.data)
  if (!data) throw unexpected(`Step ${id} has no calldata`)

  const to = asAddress(data.to)
  const calldata = asHex(data.data)
  const value = asBigInt(data.value)
  const chainId = typeof data.chainId === 'number' ? data.chainId : null
  if (!to || !calldata || value === null || chainId === null) {
    throw unexpected(`Step ${id} has incomplete calldata`)
  }

  const entry = chainByChainId(chainId)
  if (!entry) {
    throw new RelayError(`Unsupported chain id: ${chainId}`, {
      code: 'unsupported-chain',
    })
  }

  // The step id names the indexer path; the operation only decides wrap/unwrap.
  // A cross-chain quote reports operation `swap` with a `deposit` step, so
  // reading the operation alone would skip the deposit's indexing.
  const indexing =
    purpose === 'approve'
      ? ('none' as const)
      : id === 'deposit'
        ? ('deposit' as const)
        : operation === 'wrap' || operation === 'unwrap'
          ? ('single' as const)
          : ('none' as const)

  return {
    purpose,
    tx: {
      chain: entry.slug as ChainSlug,
      to,
      data: calldata,
      value,
    },
    indexing,
    awaitsStatus: asRecord(item?.check) !== null,
    label: stepLabel(id, operation, spec),
  }
}

function parseQuote(body: unknown, spec: SwapSpec): SwapQuote {
  const root = asRecord(body)
  if (!root) throw unexpected('Relay returned no quote body')

  const requestId = asString(root.requestId)
  if (!requestId) throw unexpected('Quote has no requestId')

  const details = asRecord(root.details)
  const operation = asString(details?.operation)
  if (operation !== 'wrap' && operation !== 'unwrap' && operation !== 'swap') {
    throw new RelayError(`Unsupported operation: ${String(operation)}`, {
      code: 'unsupported-operation',
    })
  }

  const currencyOut = asRecord(details?.currencyOut)
  const amountOut = asBigInt(currencyOut?.amount)
  const minimumOut = asBigInt(currencyOut?.minimumAmount)
  if (amountOut === null || minimumOut === null) {
    throw unexpected('Quote has no output amount')
  }

  if (!Array.isArray(root.steps) || root.steps.length === 0) {
    throw unexpected('Quote has no steps')
  }

  const steps = root.steps.map((raw) => parseStep(raw, operation, spec))
  const executes = steps.filter((step) => step.purpose === 'execute').length
  if (executes !== 1) {
    throw new RelayError(
      `Unsupported step layout: ${executes} transactions to send`,
      { code: 'unsupported-steps' }
    )
  }

  return { requestId, operation, amountOut, minimumOut, steps }
}

// `wallet` is the quote's user, recipient and refundTo. A quote without
// refundTo disables automatic refunds, so the caller cannot omit it.
export async function quoteSwap(input: {
  spec: SwapSpec
  wallet: `0x${string}`
  amount: bigint
}): Promise<SwapQuote> {
  const origin = chainBySlug(input.spec.from.chain)
  const destination = chainBySlug(input.spec.to.chain)
  if (!origin || !destination) {
    throw new RelayError(
      `Chain not configured: ${input.spec.from.chain} → ${input.spec.to.chain}`,
      { code: 'unsupported-chain' }
    )
  }

  const body = {
    user: input.wallet,
    recipient: input.wallet,
    refundTo: input.wallet,
    originChainId: origin.chainId,
    destinationChainId: destination.chainId,
    originCurrency: relayCurrency(input.spec.from.ref),
    destinationCurrency: relayCurrency(input.spec.to.ref),
    amount: input.amount.toString(),
    tradeType: 'EXACT_INPUT',
    ...(input.spec.slippageBps === null
      ? {}
      : { slippageTolerance: String(input.spec.slippageBps) }),
  }

  return parseQuote(await postJson(QUOTE_PATH, body), input.spec)
}

// One status read. `failure` stays live because Relay can retry or refund it;
// only `refundFailReason` makes it terminal.
export async function fetchSwapIntent(
  requestId: string
): Promise<SwapIntentStatus> {
  const body = await getJson(
    `${STATUS_PATH}?requestId=${encodeURIComponent(requestId)}`
  )
  const root = asRecord(body)
  const status = asString(root?.status)
  if (!status) throw unexpected('Relay returned no intent status')

  if (status === 'success') return { kind: 'success' }

  if (status === 'refund') {
    return { kind: 'refund', reason: asString(root?.refundFailReason) }
  }

  if (status === 'failure') {
    const reason = asString(root?.refundFailReason)
    if (reason) return { kind: 'stuck', reason }
  }

  return { kind: 'pending', status }
}

// Polls until a final status, the budget runs out, or the caller aborts. A run
// out of budget is not a failure: Relay can still settle afterwards.
export async function pollSwapIntent(input: {
  requestId: string
  shouldAbort?: () => boolean
}): Promise<SwapIntentStatus> {
  const deadline = Date.now() + POLL_BUDGET_MS
  let last: SwapIntentStatus = { kind: 'pending', status: 'unknown' }

  while (!input.shouldAbort?.()) {
    // The project's TS lib predates Promise.withResolvers.
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    if (input.shouldAbort?.()) break
    if (Date.now() >= deadline) return { kind: 'timeout' }

    try {
      const status = await fetchSwapIntent(input.requestId)
      if (status.kind !== 'pending') return status
      last = status
    } catch {
      // A transient HTTP failure is not an outcome; retry inside the budget.
    }
  }

  return last
}

// A wrap/unwrap never touches a Relay contract and a cross-chain deposit only
// shows up in an internal trace, so Relay learns about both from this call.
export async function notifyIndexer(input: {
  requestId: string
  indexing: 'single' | 'deposit'
  chain: ChainSlug
  from: `0x${string}`
  tx: SwapTx
  txHash: `0x${string}`
}): Promise<void> {
  const entry = chainBySlug(input.chain)
  if (!entry) {
    throw new RelayError(`Chain not configured: ${input.chain}`, {
      code: 'unsupported-chain',
    })
  }

  const body =
    input.indexing === 'single'
      ? {
          tx: JSON.stringify({
            from: input.from,
            to: input.tx.to,
            data: input.tx.data,
            value: input.tx.value.toString(),
            chainId: entry.chainId,
            txHash: input.txHash,
          }),
          chainId: String(entry.chainId),
          requestId: input.requestId,
        }
      : { txHash: input.txHash, chainId: entry.chainId }

  let lastError: unknown = null
  for (let attempt = 0; attempt < INDEX_ATTEMPTS; attempt += 1) {
    try {
      await postJson(
        input.indexing === 'single' ? SINGLE_PATH : INDEX_PATH,
        body
      )
      return
    } catch (error) {
      lastError = error
      if (attempt + 1 < INDEX_ATTEMPTS) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, INDEX_RETRY_WAIT_MS)
        )
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new RelayError('Relay did not accept the transaction for indexing', {
        code: 'index-failed',
      })
}
