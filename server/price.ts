import { httpExchange } from '../src/lib/http.ts'

export const PRICE_PATHS: readonly string[] = ['/api/price/eth-usdt']

const CMC_URL =
  'https://pro-api.coinmarketcap.com/v2/tools/price-conversion?amount=1&id=1027&convert=USDT'
const CACHE_MS = 60_000

type Quote = { price: number; updatedAt: string }

// CoinMarketCap bills a credit per call and only refreshes the quote once a
// minute, so a reload inside that window reuses the last answer.
let cached: { quote: Quote; at: number } | null = null

export async function handlePrice(req: Request, apiKey: string): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, 405)
  }
  if (apiKey === '') {
    return json({ error: 'CMC_API_KEY is not set' }, 503)
  }

  const now = Date.now()
  if (cached !== null && now - cached.at < CACHE_MS) {
    return json(cached.quote, 200)
  }

  const outcome = await httpExchange(CMC_URL, {
    headers: { 'X-CMC_PRO_API_KEY': apiKey, accept: 'application/json' },
  })

  if (outcome.kind === 'timeout' || outcome.kind === 'network') {
    return json({ error: 'CoinMarketCap request failed' }, 502)
  }

  const quote = outcome.kind === 'ok' ? quoteFrom(outcome.body) : null
  if (quote === null) {
    return json({ error: failureMessage(outcome.body) }, 502)
  }

  cached = { quote, at: now }
  return json(quote, 200)
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
