import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { coinmarketcapConnection } from '../support/data'
import { pnlRecordFixture } from '../support/fixtures/pnl'
import { mockPrice } from '../support/price'
import { seedVelox } from '../support/seed'

test('a seeded PnL record renders on monthly and lifetime', async ({
  app,
  browser,
  screen,
}) => {
  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    pnlRecords: [pnlRecordFixture({ name: 'Mock Collection' })],
  })

  await app.open('/pnl/monthly')
  const row = screen.getByRole('row').filter({ hasText: 'Mock Collection' })
  await expect(row).toContainText('1.0000 ETH')
  await expect(row).toContainText('$3,000.00')

  await app.open('/pnl/lifetime')
  const netTotal = browser.locator('dt:has-text("Net Total PnL") + dd')
  await expect(netTotal).toContainText('1.0000 ETH')
})

test('the PnL card renders the live ETH/USDT quote', async ({
  app,
  browser,
  screen,
}) => {
  const price = await mockPrice(browser, { price: 2_000 })

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    connections: [coinmarketcapConnection('deterministic-key')],
  })
  await app.open('/pnl/card')

  await expect(screen.getByText('ETH/USDT $2,000.00')).toBeVisible()
  expect(price.count, 'the card asked for one quote').toBe(1)
  expect(price.keys).toEqual(['deterministic-key'])
})

test('no key asks for one instead of a request error', async ({
  app,
  browser,
  screen,
}) => {
  await mockPrice(browser, {
    status: 503,
    body: { error: 'CMC_API_KEY is not set' },
  })

  await app.open('/pnl/card')

  const notice = screen
    .getByRole('status')
    .filter({ hasText: 'CoinMarketCap key' })
  await expect(notice).toContainText('CoinMarketCap key')
  await expect(
    browser.locator('[role="status"] a[href="/settings"]'),
  ).toBeVisible()
  await expect(
    browser
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'The card has no USD figure' }),
  ).toHaveCount(0)
})

test('a rejected key reports the refusal without the key', async ({
  app,
  browser,
  screen,
}) => {
  await mockPrice(browser, {
    status: 401,
    body: { error: 'bad-key-123 is not a valid key' },
  })

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    connections: [coinmarketcapConnection('bad-key-123')],
  })
  await app.open('/pnl/card')

  await expect(
    screen.getByText(
      'The card has no USD figure: CoinMarketCap rejected the key',
    ),
  ).toBeVisible()
  await expect(browser.locator('body')).not.toContainText('bad-key-123')
})

test('a rejected saved key outranks the missing-key fallback', async ({
  app,
  browser,
  screen,
}) => {
  await mockPrice(browser, {
    status: (key) => (key === null ? 503 : 401),
    body: (key) => ({
      error: key === null ? 'CMC_API_KEY is not set' : `bad key ${key}`,
    }),
  })

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    connections: [coinmarketcapConnection('stale-key')],
  })
  await app.open('/pnl/card')

  await expect(
    screen.getByText(
      'The card has no USD figure: CoinMarketCap rejected the key',
    ),
  ).toBeVisible()
  await expect(browser.locator('[role="status"]')).toHaveCount(0)
})

test('a rate limit and an unreachable provider each say what happened', async ({
  app,
  browser,
  screen,
}) => {
  await mockPrice(browser, {
    status: 429,
    body: { error: 'rate limited' },
  })

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    connections: [coinmarketcapConnection('rate-key')],
  })
  await app.open('/pnl/card')

  await expect(
    screen.getByText(
      'The card has no USD figure: CoinMarketCap rate limit reached',
    ),
  ).toBeVisible()

  await mockPrice(browser, {
    status: 502,
    body: { error: 'provider is down' },
  })
  await app.open('/pnl/card')

  await expect(
    screen.getByText(
      'The card has no USD figure: CoinMarketCap request failed',
    ),
  ).toBeVisible()
})
