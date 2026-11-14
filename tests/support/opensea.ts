import type { Browser } from '@e2e-dev/web'
import type { JsonValue } from 'e2e'

/**
 * What one mocked route saw. The counters are live: a test reads them after
 * the UI has settled, and `urls` keeps arrival order for diagnosis.
 */
export type RequestCounter = {
  readonly count: number
  readonly urls: readonly string[]
}

type MutableCounter = { count: number; urls: string[] }

function newCounter(): MutableCounter {
  return { count: 0, urls: [] }
}

function record(counter: MutableCounter, url: string): void {
  counter.count += 1
  counter.urls.push(url)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function answer(
  route: Parameters<Parameters<Browser['route']>[1]>[0],
  counter: MutableCounter,
  body: JsonValue,
): Promise<void> {
  record(counter, route.request.url)
  await route.fulfill({ status: 200, json: body })
}

/**
 * Aborts every `api.opensea.io` request no later route claims. The newest
 * route wins, so register it before the specific OpenSea mocks; a path a test
 * did not anticipate then fails instead of reaching the network.
 */
export async function guardOpenSeaHost(browser: Browser): Promise<void> {
  await browser.route('**/api.opensea.io/**', async (route) => {
    await route.abort()
  })
}

/**
 * Answers `GET /collections/{slug}` for one slug. The pattern is anchored at
 * the slug, so `/collections/{slug}/stats` is not swallowed.
 */
export async function mockCollection(
  browser: Browser,
  options: { slug: string; body: JsonValue },
): Promise<RequestCounter> {
  const counter = newCounter()
  const pattern = new RegExp(
    `/api/v2/collections/${escapeRegExp(options.slug)}$`,
  )
  await browser.route(pattern, async (route) => {
    await answer(route, counter, options.body)
  })
  return counter
}

/** Answers `GET /drops/{slug}`, the drop schedule the mint pages read. */
export async function mockDrop(
  browser: Browser,
  options: { slug: string; body: JsonValue },
): Promise<RequestCounter> {
  const counter = newCounter()
  const pattern = new RegExp(
    `/api/v2/drops/${escapeRegExp(options.slug)}$`,
  )
  await browser.route(pattern, async (route) => {
    await answer(route, counter, options.body)
  })
  return counter
}

/**
 * Answers `GET /drops/{slug}/eligibility`. When `token` is set, a request that
 * does not carry it as a bearer token gets a 401 and is not counted.
 */
export async function mockEligibility(
  browser: Browser,
  options: { slug: string; body: JsonValue; token?: string },
): Promise<RequestCounter> {
  const counter = newCounter()
  const pattern = new RegExp(
    `/api/v2/drops/${escapeRegExp(options.slug)}/eligibility$`,
  )
  await browser.route(pattern, async (route) => {
    if (
      options.token !== undefined &&
      route.request.headers.authorization !== `Bearer ${options.token}`
    ) {
      await route.fulfill({ status: 401, json: { errors: ['unauthorized'] } })
      return
    }
    await answer(route, counter, options.body)
  })
  return counter
}

/** Answers the account-NFT page the held-token scans paginate. */
export async function mockHoldings(
  browser: Browser,
  options: { chain: string; address: string; body: JsonValue },
): Promise<RequestCounter> {
  const counter = newCounter()
  const pattern = new RegExp(
    `/api/v2/chain/${escapeRegExp(options.chain)}/account/${escapeRegExp(
      options.address,
    )}/nfts(?:\\?.*)?$`,
    'i',
  )
  await browser.route(pattern, async (route) => {
    await answer(route, counter, options.body)
  })
  return counter
}

/** Answers the rarity batch the portfolio scan ranks its holdings with. */
export async function mockRarityBatch(
  browser: Browser,
  options: { body: JsonValue },
): Promise<RequestCounter> {
  const counter = newCounter()
  await browser.route(/\/api\/v2\/nfts\/batch$/, async (route) => {
    await answer(route, counter, options.body)
  })
  return counter
}

/**
 * Answers the active-listing page the cancel tab reads. The same path takes the
 * listing POST, so a non-GET request falls through to whichever route claims it.
 */
export async function mockActiveListings(
  browser: Browser,
  options: { slug: string; body: JsonValue },
): Promise<RequestCounter> {
  const counter = newCounter()
  const pattern = new RegExp(
    `/api/v2/listings/collection/${escapeRegExp(options.slug)}/all(?:\\?.*)?$`,
  )
  await browser.route(pattern, async (route) => {
    if (route.request.method !== 'GET') {
      await route.fallback()
      return
    }
    await answer(route, counter, options.body)
  })
  return counter
}

/** Answers the collection-offer page instant sell reads on scan. */
export async function mockCollectionOffers(
  browser: Browser,
  options: { slug: string; body: JsonValue },
): Promise<RequestCounter> {
  const counter = newCounter()
  const pattern = new RegExp(
    `/api/v2/offers/collection/${escapeRegExp(options.slug)}(?:\\?.*)?$`,
  )
  await browser.route(pattern, async (route) => {
    await answer(route, counter, options.body)
  })
  return counter
}

/**
 * Answers the eligibility sign-in pair, which the dev server otherwise proxies
 * to OpenSea. Both counters are returned because a test may assert the sign-in
 * happened once rather than twice.
 */
export async function mockAuth(
  browser: Browser,
  options: {
    message?: string
    token?: string
    expiresAt?: number
  } = {},
): Promise<{ nonce: RequestCounter; token: RequestCounter }> {
  const nonce = newCounter()
  const token = newCounter()

  await browser.route(/\/api\/auth\/nonce$/, async (route) => {
    await answer(route, nonce, {
      message: options.message ?? 'velox deterministic sign-in',
    })
  })
  await browser.route(/\/api\/auth\/token$/, async (route) => {
    await answer(route, token, {
      token: options.token ?? 'e2e-open-sea-token',
      expiresAt: options.expiresAt ?? Date.now() + 3_600_000,
    })
  })

  return { nonce, token }
}
