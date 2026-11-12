import type { Browser } from '@e2e-dev/web'
import type { JsonValue } from 'e2e'

export type PriceMock = {
  readonly count: number
  readonly keys: readonly (string | null)[]
}

type Tally = { count: number; keys: (string | null)[] }

/**
 * Answers `GET /api/price/eth-usdt`, with or without `?probe=1`, so the card
 * and the settings probe share one mock. A request that carried no key records
 * `null`, which is what the page sends when the server's own key would answer.
 */
export async function mockPrice(
  browser: Browser,
  options: {
    price?: number
    updatedAt?: string
    status?: number | ((key: string | null) => number)
    body?: JsonValue | ((key: string | null) => JsonValue)
  } = {},
): Promise<PriceMock> {
  const tally: Tally = { count: 0, keys: [] }

  await browser.route(
    /\/api\/price\/eth-usdt(?:\?probe=1)?$/,
    async (route) => {
      tally.count += 1
      const key = route.request.headers['x-cmc-api-key'] ?? null
      tally.keys.push(key)
      const status =
        typeof options.status === 'function' ? options.status(key) : options.status ?? 200
      const body =
        typeof options.body === 'function'
          ? options.body(key)
          : options.body ?? {
              price: options.price ?? 2_000,
              updatedAt: options.updatedAt ?? '2026-01-01T00:00:00.000Z',
            }
      await route.fulfill({ status, json: body })
    },
  )

  return {
    get count() {
      return tally.count
    },
    get keys() {
      return tally.keys
    },
  }
}
