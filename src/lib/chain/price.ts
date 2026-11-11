import { resolveKeys } from '@/lib/chain/connections'

export type EthUsdtPrice = { price: number; updatedAt: string }

const PRICE_PATH = '/api/price/eth-usdt'

export class PriceRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'PriceRequestError'
    this.status = status
  }
}

export async function fetchEthUsdtPrice(): Promise<EthUsdtPrice> {
  for (const key of await resolveKeys('coinmarketcap')) {
    try {
      return await requestPrice(key)
    } catch (failure) {
      // A rejection or a spent rate limit is worth another key. A timeout or an
      // outage would spend every key's request and still fail.
      if (
        !(failure instanceof PriceRequestError) ||
        (failure.status !== 401 &&
          failure.status !== 403 &&
          failure.status !== 429)
      ) {
        throw failure
      }
    }
  }

  // The server's own CMC_API_KEY is the last resort, including after every
  // stored key was rejected.
  return requestPrice(null)
}

export function fetchEthUsdtProbe(apiKey: string): Promise<EthUsdtPrice> {
  return requestPrice(apiKey.trim() === '' ? null : apiKey, true)
}

async function requestPrice(
  apiKey: string | null,
  probe = false
): Promise<EthUsdtPrice> {
  const response = await fetch(
    probe ? `${PRICE_PATH}?probe=1` : PRICE_PATH,
    apiKey === null ? undefined : { headers: { 'x-cmc-api-key': apiKey } }
  )
  const body = (await response.json().catch(() => null)) as
    | (EthUsdtPrice & { error?: string })
    | null

  if (!response.ok || body === null) {
    throw new PriceRequestError(
      response.status,
      body?.error ?? 'Price request failed'
    )
  }

  return body
}
