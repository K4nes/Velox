import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { parseUnits } from 'viem'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture, holdingsSpread } from '../support/fixtures/holdings'
import { listingActionFixture } from '../support/fixtures/listing-actions'
import { orderListingsFixture } from '../support/fixtures/order-listings'
import {
  expectHeldInventoryHeader,
  expectInventoryClamps,
  filterHeldInventory,
  INVENTORY_FILTER_LABEL,
} from '../support/inventory'
import { mockActiveListings, mockCollection, mockHoldings } from '../support/opensea'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'bulk-sell-mock'
const CONTRACT = '0x00000000000000000000000000000000000000bb'
const CONTRACT_UPPER = '0x00000000000000000000000000000000000000BB'
const CHAIN = 'robinhood'
const ORDER_HASH = `0x${'ab'.repeat(32)}`
const CANCEL_ORDER_HASH = `0x${'cd'.repeat(32)}`
const KEPT_ORDER_HASH = `0x${'ef'.repeat(32)}`
const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395'

test('selection and price gate the listing run', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Bulk Sell')
  // The wallet is generated per run; the test never signs, so no key is stored
  // beyond the one this run made.
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const listed: string[] = []
  await browser.route(
    /\/api\/v2\/(?:listings\/actions|orders\/.*\/seaport\/listings)$/,
    async (route) => {
      listed.push(route.request.url)
      await route.fulfill({ status: 500, json: { error: 'never listed here' } })
    },
  )

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 16),
  })

  await app.open('/bulk-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/bulk-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'bulk-sell',
    collection: SLUG,
    folder: folder.name,
  })

  const row = screen.getByRole('row').filter({ hasText: /Mock #1[^0-9]/ })
  await expect(row.getByText('#1', { exact: true })).toBeVisible()
  await expect(screen.getByRole('row')).toHaveCount(17)

  const create = screen.getByRole('button', { name: 'Create listings' })
  await expect(create).toBeDisabled()
  await expect(screen.getByText('Select at least one token')).toBeVisible()

  await screen.getByRole('checkbox', { name: 'Select token #1' }).click()
  await expect(screen.getByText(/^Items to list\s*1$/)).toBeVisible()
  await expect(screen.getByText('Enter a price per item')).toBeVisible()

  await screen.getByLabel('Price per item · ETH').fill('0.01')
  await expect(screen.getByText('Enter a price per item')).toHaveCount(0)
  await expect(create).toBeEnabled()

  expect(listed).toEqual([])

  await expectHeldInventoryHeader(screen, 16)
  await expectInventoryClamps(browser)
  await filterHeldInventory(screen, '#7')
})

test('one token spelled two ways is one row', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Bulk Sell Spelling')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  // The API is free to spell the contract in either case.
  await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsFixture([
      { contract: CONTRACT, identifier: '1', name: 'Mock #1' },
      { contract: CONTRACT_UPPER, identifier: '1', name: 'Mock #1' },
    ]),
  })

  await app.open('/bulk-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/bulk-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'bulk-sell',
    collection: SLUG,
    folder: folder.name,
  })

  await expect(screen.getByRole('row')).toHaveCount(2)
  await expectHeldInventoryHeader(screen, 1)
})

test('page state survives a round trip through another page', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Bulk Sell Keep')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  // The order submit answers only when the test releases it, so the run stays
  // in flight while the operator visits another page.
  const released = Promise.withResolvers<void>()
  const submissions: string[] = []

  await browser.route(
    /\/api\/v2\/(?:listings\/actions|orders\/.*\/seaport\/listings)$/,
    async (route) => {
      if (route.request.url.endsWith('/listings/actions')) {
        const posted = JSON.parse(route.request.postData ?? '{}')
        const item = posted.items[0]
        const endTimeSec = Math.floor(
          new Date(item.end_time).getTime() / 1000,
        )
        await route.fulfill({
          status: 200,
          json: listingActionFixture({
            offerer: posted.address,
            contract: item.contract,
            tokenId: item.token_id,
            chainId: 4663,
            protocolAddress: SEAPORT,
            startTimeSec: endTimeSec - 7 * 86_400,
            endTimeSec,
            amountWei: (
              parseUnits(item.price.amount, 18) * BigInt(item.quantity)
            ).toString(),
            quantity: item.quantity,
          }),
        })
        return
      }

      submissions.push(route.request.url)
      await released.promise
      await route.fulfill({
        status: 200,
        json: { order_hash: ORDER_HASH },
      })
    },
  )

  const collection = await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  const holdings = await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 16),
  })
  // Holds the holdings answer until the test releases it, so the scan is still
  // running while the operator visits another page.
  const holdingsReleased = Promise.withResolvers<void>()
  await browser.route(
    new RegExp(
      `/api/v2/chain/${CHAIN}/account/${wallet.address}/nfts(?:\\?.*)?$`,
      'i',
    ),
    async (route) => {
      await holdingsReleased.promise
      await route.fallback()
    },
  )

  await app.open('/bulk-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/bulk-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'bulk-sell',
    collection: SLUG,
    folder: folder.name,
  })

  await expect(screen.getByText('Scanning collection…')).toBeVisible()
  await screen.getByRole('link', { name: 'Settings' }).click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveCount(0)
  await screen.getByRole('link', { name: 'Bulk Sell' }).click()
  await expect(screen.getByText('Scanning collection…')).toBeVisible()
  holdingsReleased.resolve()
  await expect(screen.getByRole('row')).toHaveCount(17)

  await filterHeldInventory(screen, '#7')
  await screen.getByRole('checkbox', { name: 'Select token #7' }).check()
  await screen.getByLabel('Price per item · ETH').fill('0.01')
  await screen.getByRole('combobox', { name: 'Duration' }).click()
  await screen.getByRole('option', { name: '7 days' }).click()
  await expect(screen.getByText(/^Items to list\s*1$/)).toBeVisible()

  await screen.getByRole('link', { name: 'Settings' }).click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveCount(0)
  await screen.getByRole('link', { name: 'Bulk Sell' }).click()

  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveValue(SLUG)
  await expect(
    screen.getByRole('button', { name: /Select wallets/ }),
  ).toHaveText('Select wallets (1 selected)')
  await expect(screen.getByLabel(INVENTORY_FILTER_LABEL)).toHaveValue('#7')
  await expect(screen.getByRole('row')).toHaveCount(2)
  await expectHeldInventoryHeader(screen, 1)
  await expect(
    screen.getByRole('checkbox', { name: 'Select token #7' }),
  ).toBeChecked()
  await expect(screen.getByLabel('Price per item · ETH')).toHaveValue('0.01')
  await expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveText(
    '7 days',
  )

  const row = screen.getByRole('row').filter({ hasText: /Mock #7[^0-9]/ })
  await screen.getByRole('button', { name: 'Create listings' }).click()
  await expect(row).toContainText('Submitting')

  await screen.getByRole('link', { name: 'Settings' }).click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveCount(0)
  await screen.getByRole('link', { name: 'Bulk Sell' }).click()
  await expect(row).toContainText('Submitting')
  released.resolve()

  await expect(row).toContainText('Listed')
  await expect(screen.getByText('1 of 1 listed')).toBeVisible()
  expect(submissions.length).toBe(1)
  expect(holdings.count).toBe(1)
  expect(collection.count).toBe(1)
})

test('the cancel tab withdraws an active listing in one click', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Bulk Sell Cancel')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const nowSec = Math.floor(Date.now() / 1000)
  const cancels: { url: string; signature: unknown }[] = []

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Collection',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 16),
  })
  const listings = await mockActiveListings(browser, {
    chain: CHAIN,
    body: orderListingsFixture({
      chain: CHAIN,
      maker: wallet.address,
      contract: CONTRACT,
      protocolAddress: SEAPORT,
      orders: [
        {
          tokenId: '1',
          orderHash: CANCEL_ORDER_HASH,
          priceWei: '10000000000000000',
          startTimeSec: nowSec - 3_600,
          expirationTimeSec: nowSec + 7 * 86_400,
        },
        {
          tokenId: '2',
          orderHash: KEPT_ORDER_HASH,
          priceWei: '10000000000000000',
          startTimeSec: nowSec - 3_600,
          expirationTimeSec: nowSec + 9 * 86_400,
        },
      ],
    }),
  })
  await browser.route(
    /\/api\/v2\/orders\/chain\/[^/]+\/protocol\/0x[0-9a-fA-F]{40}\/0x[0-9a-fA-F]{64}\/cancel$/,
    async (route) => {
      const posted = JSON.parse(route.request.postData ?? '{}')
      cancels.push({ url: route.request.url, signature: posted.offererSignature })
      await route.fulfill({
        status: 200,
        json: {
          // A fulfillment signature vended before the cancel stays fillable for
          // up to five minutes, which is what the row has to report.
          last_signature_issued_valid_until: new Date(
            (nowSec + 240) * 1000,
          ).toISOString(),
        },
      })
    },
  )

  await app.open('/bulk-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/bulk-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'bulk-sell',
    collection: SLUG,
    folder: folder.name,
  })

  const createTab = screen.getByRole('tab', { name: 'Create listings' })
  const cancelTab = screen.getByRole('tab', { name: 'Cancel listings' })
  await expect(createTab).toHaveAttribute('aria-selected', 'true')
  await expect(cancelTab).toHaveAttribute('aria-selected', 'false')
  await expect(listings.count).toBe(0)

  await cancelTab.click()

  await expect(cancelTab).toHaveAttribute('aria-selected', 'true')
  await expect(screen.getByText('2 orders', { exact: true })).toBeVisible()
  await expect(
    screen.getByRole('button', { name: /Copy order hash 0xcdcdcdcd/ }),
  ).toBeVisible()

  // Every order is selected when the read lands, so a full cancel stays one
  // click; the box is what narrows the batch.
  const selectAll = screen.getByRole('checkbox', {
    name: 'Select every active listing',
  })
  const listedBox = screen.getByRole('checkbox', { name: 'Select listing #1' })
  const keptBox = screen.getByRole('checkbox', { name: 'Select listing #2' })
  await expect(selectAll).toBeChecked()
  await expect(listedBox).toBeChecked()
  await expect(keptBox).toBeChecked()

  // A batch that ignored the boxes would still pass every assertion above, so the
  // run below leaves one order out and counts the requests.
  await keptBox.click()
  await expect(
    screen.getByRole('button', { name: 'Cancel 1 listing' }),
  ).toBeEnabled()
  await expect(listedBox).toBeChecked()

  await screen.getByRole('button', { name: 'Cancel 1 listing' }).click()

  await expect(screen.getByText('Cancelled', { exact: true })).toBeVisible()
  await expect(screen.getByText('1 of 1 cancelled')).toBeVisible()
  await expect(screen.getByText(/^fills \d+m$/)).toBeVisible()
  // The order left unchecked keeps its expiry line and was never withdrawn.
  await expect(screen.getByText(/^expires \d+d$/)).toBeVisible()

  expect(cancels.length).toBe(1)
  expect(cancels[0]?.url).toContain(CANCEL_ORDER_HASH)
  expect(cancels[0]?.url).not.toContain(KEPT_ORDER_HASH)
  // The offerer signed the order hash itself, so the request carries a 65-byte
  // signature and not a copy of the order terms.
  expect(String(cancels[0]?.signature)).toMatch(/^0x[0-9a-fA-F]{130}$/)

  // Nothing reloaded: the scanned inventory is still on screen beside the rail.
  await expect(screen.getByRole('row')).toHaveCount(17)
})
