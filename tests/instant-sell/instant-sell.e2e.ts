import { test } from '@e2e-dev/web'
import { formatUnits } from 'viem'
import { expect } from 'e2e'
import type { JsonValue } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture } from '../support/fixtures/holdings'
import {
  expectHeldInventoryHeader,
  filterHeldInventory,
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
    body: holdingsFixture([
      { contract: CONTRACT, identifier: TOKEN_ID },
      { contract: CONTRACT, identifier: '2' },
      { contract: CONTRACT, identifier: '3' },
    ]),
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
  const row = screen.getByRole('row').filter({ hasText: 'Mock #1' })
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

  await expectHeldInventoryHeader(screen, 3)
  await filterHeldInventory(screen, '#2')
})
