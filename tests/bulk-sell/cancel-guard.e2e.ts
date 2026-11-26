import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture, holdingsSpread } from '../support/fixtures/holdings'
import { orderListingsFixture } from '../support/fixtures/order-listings'
import { mockActiveListings, mockCollection, mockHoldings } from '../support/opensea'
import { READ_COLLECTION_LABEL, scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'cancel-guard'
const OTHER_SLUG = 'cancel-guard-other'
const CONTRACT = '0x00000000000000000000000000000000000000bb'
const CHAIN = 'robinhood'
const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395'
const ACTIVE_ORDER = `0x${'ab'.repeat(32)}`
const STALE_ORDER = `0x${'cd'.repeat(32)}`

test('a listing the API reports as cancelled is not offered for cancel', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Cancel Status')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const nowSec = Math.floor(Date.now() / 1000)
  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Cancel Status',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 2),
  })
  await mockActiveListings(browser, {
    slug: SLUG,
    body: orderListingsFixture({
      chain: CHAIN,
      maker: wallet.address,
      contract: CONTRACT,
      protocolAddress: SEAPORT,
      orders: [
        {
          tokenId: '1',
          orderHash: ACTIVE_ORDER,
          priceWei: '10000000000000000',
          startTimeSec: nowSec - 3_600,
          expirationTimeSec: nowSec + 7 * 86_400,
        },
        {
          tokenId: '2',
          orderHash: STALE_ORDER,
          priceWei: '10000000000000000',
          startTimeSec: nowSec - 3_600,
          expirationTimeSec: nowSec + 9 * 86_400,
          status: 'CANCELLED',
        },
      ],
    }),
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
  await screen.getByRole('tab', { name: 'Cancel listings' }).click()

  await expect(screen.getByText('1 order', { exact: true })).toBeVisible()
  await expect(
    screen.getByRole('button', { name: 'Copy order hash 0xabababab' })
  ).toBeVisible()
  await expect(
    screen.getByRole('button', { name: 'Copy order hash 0xcdcdcdcd' })
  ).toHaveCount(0)
})

test('switching collections drops the previous read before the new one fails', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Cancel Switch')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const nowSec = Math.floor(Date.now() / 1000)
  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Cancel Switch A',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockCollection(browser, {
    slug: OTHER_SLUG,
    body: collectionFixture({
      slug: OTHER_SLUG,
      name: 'Cancel Switch B',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsSpread(CONTRACT, 2),
  })
  await mockActiveListings(browser, {
    slug: SLUG,
    body: orderListingsFixture({
      chain: CHAIN,
      maker: wallet.address,
      contract: CONTRACT,
      protocolAddress: SEAPORT,
      orders: [
        {
          tokenId: '1',
          orderHash: ACTIVE_ORDER,
          priceWei: '10000000000000000',
          startTimeSec: nowSec - 3_600,
          expirationTimeSec: nowSec + 7 * 86_400,
        },
      ],
    }),
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
  await screen.getByRole('tab', { name: 'Cancel listings' }).click()
  await expect(
    screen.getByRole('button', { name: 'Copy order hash 0xabababab' })
  ).toBeVisible()

  // B's read fails after A's rows were on screen. The wallet and the field stay,
  // so the operator sees the failure rather than a silent empty list.
  await browser.route(
    new RegExp(`/api/v2/listings/collection/${OTHER_SLUG}/all(?:\\?.*)?$`),
    async (route) => {
      await route.fulfill({ status: 500, json: {} })
    },
  )
  await browser.route(
    new RegExp(
      `/api/v2/chain/${CHAIN}/account/${wallet.address}/nfts(?:\\?.*)?$`,
      'i',
    ),
    async (route) => {
      await route.fulfill({ status: 200, json: holdingsFixture([]) })
    },
  )

  await screen.getByLabel(READ_COLLECTION_LABEL, { exact: true }).fill(OTHER_SLUG)
  await screen.getByRole('button', { name: 'Scan held NFTs' }).click()

  await expect(browser.locator('p[role="alert"]')).toBeVisible()
  await expect(
    screen.getByRole('button', { name: 'Copy order hash 0xabababab' })
  ).toHaveCount(0)
  await expect(
    screen.getByRole('button', { name: 'Cancel 0 listings' })
  ).toBeDisabled()
})
