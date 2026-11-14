import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture, holdingsSpread } from '../support/fixtures/holdings'
import {
  expectHeldInventoryHeader,
  expectInventoryClamps,
  filterHeldInventory,
  INVENTORY_FILTER_LABEL,
} from '../support/inventory'
import { mockCollection, mockHoldings, mockRarityBatch } from '../support/opensea'
import { mockPrice } from '../support/price'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'mock-collection'
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const SECOND_SLUG = 'second-collection'
const SECOND_CONTRACT = '0x00000000000000000000000000000000000000cc'

test('a scan fills the inventory and the owned count', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Portfolio')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 16),
  })
  await mockRarityBatch(browser, {
    body: {
      nfts: Array.from({ length: 16 }, (_, index) => ({
        identifier: String(index + 1),
        rarity: { rank: index + 5 },
      })),
    },
  })

  // The scan also reads stats and the ETH price; both fail soft, but a live
  // request is still a request, so answer them here.
  await browser.route(
    new RegExp(`/api/v2/collections/${SLUG}/stats$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        json: { total: { floor_price: 0.5, floor_price_symbol: 'ETH' } },
      })
    },
  )
  await mockPrice(browser, { price: 2_000 })

  await app.open('/portfolio')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/portfolio')

  await expect(
    screen.getByRole(
      'cell',
      'Scan this collection to see what the selected wallets hold.',
    ),
  ).toBeVisible()

  await scanCollection({
    browser,
    screen,
    feature: 'portfolio',
    collection: SLUG,
    folder: folder.name,
  })

  const row = screen.getByRole('row').filter({ hasText: /Mock #1[^0-9]/ })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Mock #1')
  await expect(row).toContainText('#1')

  const totalOwned = browser.locator(
    'xpath=//dt[normalize-space(.)="Total owned"]/following-sibling::dd/span[1]',
  )
  await expect(totalOwned).toHaveText('16')

  await expect(screen.getByText(/could not be ranked/)).toHaveCount(0)

  await expectHeldInventoryHeader(screen, 16)
  await expectInventoryClamps(browser)
  await filterHeldInventory(screen, '#7')
})

test('page state survives a round trip through another page', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Portfolio Keep')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 16),
  })
  await mockRarityBatch(browser, {
    body: {
      nfts: Array.from({ length: 16 }, (_, index) => ({
        identifier: String(index + 1),
        rarity: { rank: index + 5 },
      })),
    },
  })
  await browser.route(
    new RegExp(`/api/v2/collections/${SLUG}/stats$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        json: { total: { floor_price: 0.5, floor_price_symbol: 'ETH' } },
      })
    },
  )
  await mockPrice(browser, { price: 2_000 })

  // Holds the holdings answer until the test releases it, so the scan is still
  // running while the operator visits another page.
  const holdingsReleased = Promise.withResolvers<void>()
  await browser.route(
    new RegExp(
      `/api/v2/chain/robinhood/account/${wallet.address}/nfts(?:\\?.*)?$`,
      'i',
    ),
    async (route) => {
      await holdingsReleased.promise
      await route.fallback()
    },
  )

  await app.open('/portfolio')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/portfolio')

  await scanCollection({
    browser,
    screen,
    feature: 'portfolio',
    collection: SLUG,
    folder: folder.name,
  })

  await expect(screen.getByText('Scanning Mock Collection…')).toBeVisible()
  await browser.locator('a[href="/settings"]').first().click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveCount(0)
  await browser.locator('a[href="/portfolio"]').first().click()
  await expect(screen.getByText('Scanning Mock Collection…')).toBeVisible()

  holdingsReleased.resolve()
  await expect(screen.getByRole('row')).toHaveCount(17)

  await filterHeldInventory(screen, '#7')
  await screen.getByRole('button', { name: 'Rare (1)' }).click()
  await screen.getByRole('combobox', { name: 'Sort held tokens' }).click()
  await screen.getByRole('option', { name: 'Commonest first' }).click()

  await browser.locator('a[href="/settings"]').first().click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveCount(0)
  await browser.locator('a[href="/portfolio"]').first().click()

  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveValue(SLUG)
  await expect(
    screen.getByRole('button', { name: /Select wallets/ }),
  ).toHaveText('Select wallets (1 selected)')
  await expect(screen.getByLabel(INVENTORY_FILTER_LABEL)).toHaveValue('#7')
  await expect(
    screen.getByRole('button', { name: 'Rare (1)' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    screen.getByRole('combobox', { name: 'Sort held tokens' }),
  ).toHaveText('Commonest first')
  await expect(screen.getByRole('row')).toHaveCount(2)
  await expectHeldInventoryHeader(screen, 1)
  await expect(
    screen.getByRole('row').filter({ hasText: /Mock #7[^0-9]/ }),
  ).toContainText('Mock #7')

  // A new scan replaces the retained result. The filter and tier are cleared
  // first so the second collection's row is what the table can show.
  await mockCollection(browser, {
    slug: SECOND_SLUG,
    body: collectionFixture({
      slug: SECOND_SLUG,
      name: 'Second Collection',
      contract: SECOND_CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([
      { contract: SECOND_CONTRACT, identifier: '42', name: 'Second #42' },
    ]),
  })

  await screen.getByLabel(INVENTORY_FILTER_LABEL).fill('')
  await screen.getByRole('button', { name: /^All/ }).click()
  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill(SECOND_SLUG)
  await screen.getByRole('button', { name: 'Scan portfolio' }).click()
  await expect(
    screen.getByRole('row').filter({ hasText: /Second #42/ }),
  ).toBeVisible()
  await expect(
    screen.getByRole('row').filter({ hasText: /Mock #7[^0-9]/ }),
  ).toHaveCount(0)
})
