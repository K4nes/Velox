import { httpExchange, type HttpOutcome } from '../src/lib/http.ts'

export const PRICE_PATHS: readonly string[] = ['/api/price/eth-usdt']

const CMC_URL =
  'https://pro-api.coinmarketcap.com/v2/tools/price-conversion?amount=1&id=1027&convert=USDT'
const CACHE_MS = 60_000
const MAX_KEY_LENGTH = 128
const MAX_CACHED_KEYS = 8

type Quote = { price: number; updatedAt: string }

// CoinMarketCap bills a credit per call and only refreshes the quote once a
// minute, so a reload inside that window reuses the last answer. The key is part
// of the entry: a quote one key fetched must never answer for a rotated one.
const cache = new Map<string, { quote: Quote; at: number }>()

// Concurrent misses would each bill a call, so they share the one exchange per
// key in use.
const pending = new Map<string, Promise<HttpOutcome>>()

export async function handlePrice(req: Request, envKey: string): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, 405)
  }

  const headerKey = readHeaderKey(req.headers.get('x-cmc-api-key'))
  if (headerKey === null) {
    return json({ error: 'invalid x-cmc-api-key header' }, 400)
  }

  // The header is the operator testing a key before saving it, so it outranks
  // the environment's key; an absent header falls back to the environment.
  const key = headerKey === '' ? envKey : headerKey
  if (key === '') {
    return json({ error: 'CMC_API_KEY is not set' }, 503)
  }

  // A probe exists to prove the key, so a cached answer would prove nothing.
  const probe = new URL(req.url).searchParams.get('probe') === '1'
  const entry = cache.get(key)
  if (!probe && entry !== undefined && Date.now() - entry.at < CACHE_MS) {
    return json(entry.quote, 200)
  }

  let exchange = pending.get(key)
  if (exchange === undefined) {
    exchange = httpExchange(CMC_URL, {
      headers: { 'X-CMC_PRO_API_KEY': key, accept: 'application/json' },
    }).finally(() => {
      pending.delete(key)
    })
    pending.set(key, exchange)
  }

  const outcome = await exchange

  if (outcome.kind === 'timeout' || outcome.kind === 'network') {
    return json({ error: 'CoinMarketCap request failed' }, 502)
  }

  // CMC answers a bad key with its own message, which can quote the key back.
  // A fixed one keeps the secret out of every tooltip and toast.
  if (outcome.kind === 'status' && (outcome.status === 401 || outcome.status === 403)) {
    return json({ error: 'CoinMarketCap rejected the key' }, 401)
  }
  if (outcome.kind === 'status' && outcome.status === 429) {
    return json({ error: 'CoinMarketCap rate limit reached' }, 429)
  }

  const quote = outcome.kind === 'ok' ? quoteFrom(outcome.body) : null
  if (quote === null) {
    return json({ error: failureMessage(outcome.body) }, 502)
  }

  remember(key, quote)
  return json(quote, 200)
}

function readHeaderKey(value: string | null): string | null {
  if (value === null) {
    return ''
  }
  // A pasted key can carry control characters, which never belong in a header.
  if (value.length > MAX_KEY_LENGTH || hasControlChar(value)) {
    return null
  }
  return value.trim()
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

function remember(key: string, quote: Quote): void {
  cache.delete(key)
  cache.set(key, { quote, at: Date.now() })
  // Rotation would otherwise pin every retired key for the process's lifetime.
  while (cache.size > MAX_CACHED_KEYS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) {
      return
    }
    cache.delete(oldest)
  }
}

function quoteFrom(body: unknown): Quote | null {
  const usdt = read(read(read(body, 'data'), 'quote'), 'USDT')
  const price = read(usdt, 'price')
  const updatedAt = read(usdt, 'last_updated')

  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  if (typeof updatedAt !== 'string' || updatedAt === '') return null
  return { price, updatedAt }
}

function failureMessage(body: unknown): string {
  const message = read(read(body, 'status'), 'error_message')
  return typeof message === 'string' && message !== ''
    ? message
    : 'CoinMarketCap request failed'
}

function read(source: unknown, key: string): unknown {
  return typeof source === 'object' && source !== null
    ? (source as Record<string, unknown>)[key]
    : undefined
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
