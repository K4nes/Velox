import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture } from '../support/fixtures/holdings'
import { mockCollection, mockHoldings, mockRarityBatch } from '../support/opensea'
import { mockPrice } from '../support/price'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'mock-collection'
const CONTRACT = '0x00000000000000000000000000000000000000aa'

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
    body: holdingsFixture([
      { contract: CONTRACT, identifier: '1', name: 'Mock #1' },
    ]),
  })
  await mockRarityBatch(browser, {
    body: { nfts: [{ identifier: '1', rarity: { rank: 5 } }] },
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

  const row = screen.getByRole('row').filter({ hasText: 'Mock #1' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Mock #1')
  await expect(row).toContainText('#1')

  const totalOwned = browser.locator(
    'xpath=//dt[normalize-space(.)="Total owned"]/following-sibling::dd/span[1]',
  )
  await expect(totalOwned).toHaveText('1')

  await expect(screen.getByText(/could not be ranked/)).toHaveCount(0)
})
