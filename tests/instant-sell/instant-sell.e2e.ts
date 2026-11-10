import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { JsonValue } from 'e2e'
import {
  mintWallets,
  openseaConnection,
  RH8_FOLDER,
} from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture } from '../support/fixtures/holdings'
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

test('one bid covers one selected token', async ({
  app,
  browser,
  screen,
}) => {
  const [wallet] = mintWallets(1)

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
    body: holdingsFixture([{ contract: CONTRACT, identifier: TOKEN_ID }]),
  })
  const offers = await mockCollectionOffers(browser, {
    slug: SLUG,
    // The fixture's inferred `criteria: {}` has no index signature, so its
    // return type is not accepted as JsonValue without the cast.
    body: offerLadderFixture({
      contract: CONTRACT,
      tokenId: TOKEN_ID,
    }) as unknown as JsonValue,
  })

  await app.open('/instant-sell')
  await seedVelox(browser, {
    folders: [RH8_FOLDER],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/instant-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'instant-sell',
    collection: SLUG,
  })

  // The row's bid renders only after the offers response converts into a live
  // bid, so this is the positive signal the empty state cannot fake.
  const row = screen.getByRole('row').filter({ hasText: 'Mock #1' })
  await expect(row.getByText('0.1 ETH')).toBeVisible()
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
})
