import { test } from '@e2e-dev/web'
import { formatUnits } from 'viem'
import { expect } from 'e2e'
import type { JsonValue } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsSpread } from '../support/fixtures/holdings'
import {
  expectHeldInventoryHeader,
  expectInventoryClamps,
  filterHeldInventory,
  INVENTORY_FILTER_LABEL,
} from '../support/inventory'
import { offerLadderFixture } from '../support/fixtures/offers'
import {
  mockCollection,
  mockCollectionOffers,
  mockHoldings,
} from '../support/opensea'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'mock-collection'
const CONTRACT = '0x00000000000000000000000000000000000000bb'
const TOKEN_ID = '1'
const PINNED_WEI = 500_000_000_000_000_000n
const WETH_ADDRESS = `0x${'00'.repeat(18)}f0f0`

test('one bid covers one selected token', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Instant Sell')
  const [wallet] = mintWallets(1, folder.id)

  // Registered first, so the specific mocks below win: any OpenSea path they
  // do not answer is aborted rather than reaching the live API.
  await browser.route('https://api.opensea.io/**', async (route) => {
    await route.abort()
  })

  const collection = await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
    }),
  })
  const holdings = await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 16),
  })
  const offers = await mockCollectionOffers(browser, {
    slug: SLUG,
    // The fixture types `consideration` as `unknown[]`, which JsonValue rejects.
    body: offerLadderFixture({
      contract: CONTRACT,
      tokenId: TOKEN_ID,
      count: 12,
      pinned: { tokenIds: '2', priceWei: PINNED_WEI },
    }) as unknown as JsonValue,
  })

  await app.open('/instant-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/instant-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'instant-sell',
    collection: SLUG,
    folder: folder.name,
  })

  // The row's bid renders only after the offers response converts into a live
  // bid, so this is the positive signal the empty state cannot fake.
  const row = screen.getByRole('row').filter({ hasText: /Mock #1[^0-9]/ })
  await expect(row.getByText('0.1 ETH')).toBeVisible()
  await expect(
    screen.getByText(`${formatUnits(PINNED_WEI, 18)} ETH`)
  ).toHaveCount(0)
  await expect(screen.getByText('Last update just now')).toBeVisible()

  const layout = await browser.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent === 'Active OpenSea Offers'
    )
    const card = heading?.closest('[data-slot="card"]')
    const list = card?.querySelector<HTMLElement>('[class*="overflow-y-auto"]')
    const page = document.scrollingElement
    return {
      pageScrolls:
        page === null ? true : page.scrollHeight > window.innerHeight + 1,
      listScrolls: list ? list.scrollHeight > list.clientHeight + 1 : false,
    }
  })
  expect(layout.pageScrolls).toBe(false)
  expect(layout.listScrolls).toBe(true)
  await expect.poll(() => offers.count).toBeGreaterThan(0)
  expect(collection.count).toBe(1)
  expect(holdings.count).toBe(1)

  await expect(
    screen.getByText('No active collection offers')
  ).not.toBeVisible()
  await expect(screen.getByRole('button', 'Accept 0 offers')).toBeDisabled()

  await screen
    .getByRole('checkbox', { name: `Select token #${TOKEN_ID}` })
    .check()

  const selected = browser.locator(
    "xpath=//dt[normalize-space()='Selected']/following-sibling::dd[1]"
  )
  const covered = browser.locator(
    "xpath=//dt[normalize-space()='Covered']/following-sibling::dd[1]"
  )
  await expect(selected).toHaveText('1')
  await expect(covered).toHaveText('1')
  await expect(screen.getByRole('button', 'Accept 1 offer')).toBeEnabled()

  await expectHeldInventoryHeader(screen, 16)
  await expectInventoryClamps(browser)
  await filterHeldInventory(screen, '#7')
})

test('page state survives a round trip through another page', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Instant Sell Keep')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await browser.route('https://api.opensea.io/**', async (route) => {
    await route.abort()
  })

  const collection = await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
    }),
  })
  const holdings = await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 16),
  })

  // Two currencies, so the rail renders the picker and the operator's pick has
  // a visible effect. The fixture keeps every money item on the zero address,
  // so the second ladder moves its own to a different address.
  const eth = offerLadderFixture({
    contract: CONTRACT,
    tokenId: TOKEN_ID,
    count: 12,
  })
  const weth = offerLadderFixture({
    contract: CONTRACT,
    tokenId: TOKEN_ID,
    count: 12,
    currency: { symbol: 'WETH' },
  })
  await mockCollectionOffers(browser, {
    slug: SLUG,
    body: {
      offers: [
        ...eth.offers,
        ...weth.offers.map((offer, index) => ({
          ...offer,
          order_hash: `0x${(index + 17).toString(16).padStart(64, '0')}`,
          protocol_data: {
            ...offer.protocol_data,
            parameters: {
              ...offer.protocol_data.parameters,
              offer: offer.protocol_data.parameters.offer.map((item) => ({
                ...item,
                token: WETH_ADDRESS,
              })),
            },
          },
        })),
      ],
      next: null,
    } as unknown as JsonValue,
  })

  // Holds the holdings answer until the test releases it, so the scan is still
  // running while the operator visits another page.
  const holdingsReleased = Promise.withResolvers<void>()
  await browser.route(
    new RegExp(
      `/api/v2/chain/robinhood/account/${wallet.address}/nfts(?:\\?.*)?$`,
      'i'
    ),
    async (route) => {
      await holdingsReleased.promise
      await route.fallback()
    }
  )

  await app.open('/instant-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/instant-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'instant-sell',
    collection: SLUG,
    folder: folder.name,
  })

  await expect(screen.getByText('Scanning collection…')).toBeVisible()
  await screen.getByRole('link', { name: 'Settings' }).click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)')
  ).toHaveCount(0)
  await screen.getByRole('link', { name: 'Instant Sell' }).click()
  await expect(screen.getByText('Scanning collection…')).toBeVisible()
  holdingsReleased.resolve()
  await expect(screen.getByRole('row')).toHaveCount(17)

  const firstRow = screen.getByRole('row').filter({ hasText: /Mock #1[^0-9]/ })
  await expect(firstRow).toContainText('0.1 ETH')

  const wethButton = screen.getByRole('button', { name: /WETH/ })
  const ethButton = screen.getByRole('button', { name: /^ETH/ })
  await wethButton.click()
  await expect(wethButton).toHaveAttribute('aria-pressed', 'true')
  await expect(firstRow).toContainText('0.1 WETH')

  await filterHeldInventory(screen, '#7')
  await screen.getByRole('checkbox', { name: 'Select token #7' }).check()
  const selected = browser.locator(
    "xpath=//dt[normalize-space()='Selected']/following-sibling::dd[1]"
  )
  await expect(selected).toHaveText('1')

  const row = screen.getByRole('row').filter({ hasText: /Mock #7[^0-9]/ })
  await expect(row).toContainText('0.1 WETH')

  await screen.getByRole('link', { name: 'Settings' }).click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)')
  ).toHaveCount(0)
  await screen.getByRole('link', { name: 'Instant Sell' }).click()

  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)')
  ).toHaveValue(SLUG)
  await expect(
    screen.getByRole('button', { name: /Select wallets/ })
  ).toHaveText('Select wallets (1 selected)')
  await expect(screen.getByLabel(INVENTORY_FILTER_LABEL)).toHaveValue('#7')
  await expect(screen.getByRole('row')).toHaveCount(2)
  await expectHeldInventoryHeader(screen, 1)
  await expect(
    screen.getByRole('checkbox', { name: 'Select token #7' })
  ).toBeChecked()
  await expect(selected).toHaveText('1')

  await expect(screen.getByText('Last update just now')).toBeVisible()
  await expect(screen.getByRole('button', { name: /WETH/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(ethButton).toHaveAttribute('aria-pressed', 'false')
  await expect(
    screen.getByRole('row').filter({ hasText: /Mock #7[^0-9]/ })
  ).toContainText('0.1 WETH')

  expect(collection.count).toBe(1)
  expect(holdings.count).toBe(1)
})
