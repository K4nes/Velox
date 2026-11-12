import { resolveKeys } from '@/lib/chain/connections'
import { requestEthUsdtPrice } from '@/lib/chain/transport'

export type EthUsdtPrice = { price: number; updatedAt: string }

/** Why the card has no figure. The provider's own text never reaches the UI. */
export type QuoteFailure =
  | { kind: 'missing-key' }
  | { kind: 'rejected' }
  | { kind: 'rate-limited' }
  | { kind: 'unreachable' }

const COPY: Record<QuoteFailure['kind'], string> = {
  'missing-key': 'CoinMarketCap key is required',
  rejected: 'CoinMarketCap rejected the key',
  'rate-limited': 'CoinMarketCap rate limit reached',
  unreachable: 'CoinMarketCap request failed',
}

// A provider answer can quote the key back, so the kind is decided from the
// status and the copy is fixed here. The retry flag belongs to the same table,
// so a new status cannot be classified in one place and retried in another.
const STATUS: Record<number, { kind: QuoteFailure['kind']; retry: boolean }> = {
  401: { kind: 'rejected', retry: true },
  403: { kind: 'rejected', retry: true },
  429: { kind: 'rate-limited', retry: true },
  503: { kind: 'missing-key', retry: false },
}

export class PriceRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'PriceRequestError'
    this.status = status
  }
}

export function quoteFailure(error: unknown): QuoteFailure {
  if (!(error instanceof PriceRequestError)) return { kind: 'unreachable' }
  return { kind: STATUS[error.status]?.kind ?? 'unreachable' }
}

export function quoteFailureMessage(failure: QuoteFailure): string {
  return COPY[failure.kind]
}

export async function fetchEthUsdtPrice(): Promise<EthUsdtPrice> {
  let storedFailure: PriceRequestError | null = null

  for (const key of await resolveKeys('coinmarketcap')) {
    try {
      return await requestPrice(key)
    } catch (failure) {
      // A rejection or a spent rate limit is worth another key. A timeout or an
      // outage would spend every key's request and still fail.
      if (!isRetryable(failure)) throw failure
      storedFailure = failure
    }
  }

  // The server's own CMC_API_KEY is the last resort, including after every
  // stored key was rejected.
  try {
    return await requestPrice(null)
  } catch (failure) {
    // An installed app has no server key, so its 503 must not mask the saved
    // key the provider already refused.
    if (
      storedFailure !== null &&
      failure instanceof PriceRequestError &&
      failure.status === 503
    ) {
      throw storedFailure
    }
    throw failure
  }
}

export function fetchEthUsdtProbe(apiKey: string): Promise<EthUsdtPrice> {
  const key = apiKey.trim()
  return requestPrice(key === '' ? null : key, true)
}

function isRetryable(failure: unknown): failure is PriceRequestError {
  return (
    failure instanceof PriceRequestError && STATUS[failure.status]?.retry === true
  )
}

async function requestPrice(
  apiKey: string | null,
  probe = false
): Promise<EthUsdtPrice> {
  const reply = await requestEthUsdtPrice({ key: apiKey, probe })
  if (reply.status !== 200) {
    const kind = STATUS[reply.status]?.kind ?? 'unreachable'
    throw new PriceRequestError(reply.status, COPY[kind])
  }

  const quote = quoteFrom(reply.body)
  if (quote === null) throw new PriceRequestError(502, COPY.unreachable)
  return quote
}

function quoteFrom(body: unknown): EthUsdtPrice | null {
  if (typeof body !== 'object' || body === null) return null
  const { price, updatedAt } = body as Record<string, unknown>
  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  if (typeof updatedAt !== 'string' || updatedAt === '') return null
  return { price, updatedAt }
}
