import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { guardOpenSeaHost, mockCollection } from '../support/opensea'
import { READ_COLLECTION_LABEL, scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SCATTER_SLUG = 'scatter-pnl-card'
const OPENSEA_SLUG = 'opensea-pnl-card'
const CONTRACT = '0x00000000000000000000000000000000000000dd'
const SCATTER_REFUSAL =
  'Scatter is mint-only in Velox — mint it from the Mint page.'

test('a Scatter collection URL is refused without a provider request', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('PnL Card Scatter')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  // Registered first, so the mock below wins and any other OpenSea path aborts.
  await guardOpenSeaHost(browser)
  const collection = await mockCollection(browser, {
    slug: SCATTER_SLUG,
    body: collectionFixture({
      slug: SCATTER_SLUG,
      name: 'Scatter Collection',
      contract: CONTRACT,
    }),
  })

  await app.open('/pnl/card')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/pnl/card')

  // The card reports a refusal through its toast, the surface a failed check
  // already uses. A second refusal is a second toast, so the count is what
  // proves the second click answered rather than the first one lingering.
  const refusal = browser
    .locator('[data-sonner-toast]')
    .filter({ hasText: SCATTER_REFUSAL })

  await scanCollection({
    browser,
    screen,
    feature: 'pnl-card',
    collection: `https://scatter.art/c/${SCATTER_SLUG}`,
    folder: folder.name,
  })
  await expect(refusal).toHaveCount(1)

  // The token-shaped URL is the shape the slug gate used to swallow, so the
  // field is filled again and the wallet step is left as it stands.
  await screen
    .getByLabel(READ_COLLECTION_LABEL, { exact: true })
    .fill(`https://scatter.art/c/${SCATTER_SLUG}/42`)
  await screen.getByRole('button', { name: 'Check PnL' }).click()
  await expect(refusal).toHaveCount(2)

  expect(collection.count).toBe(0)
})

test('a bare OpenSea slug is read once through the collection route', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('PnL Card OpenSea')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await guardOpenSeaHost(browser)
  // A chain with no explorer API ends the check after the collection read, so
  // the fixture never has to answer a trades route.
  const collection = await mockCollection(browser, {
    slug: OPENSEA_SLUG,
    body: collectionFixture({
      slug: OPENSEA_SLUG,
      name: 'OpenSea Collection',
      contract: CONTRACT,
      chain: 'base',
    }),
  })

  await app.open('/pnl/card')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/pnl/card')

  // A bare slug, which the card resolves through the source resolver rather
  // than the URL parser.
  await scanCollection({
    browser,
    screen,
    feature: 'pnl-card',
    collection: OPENSEA_SLUG,
    folder: folder.name,
  })

  await expect.poll(() => collection.count).toBe(1)
  expect(collection.urls[0]).toContain(`/collections/${OPENSEA_SLUG}`)
  // The answer has to reach the card, not just the network. The preview prints
  // the name the read returned.
  await expect(screen.getByText('OpenSea Collection')).toBeVisible()
})

test('the Scatter refusal answers before the wallet check', async ({
  app,
  browser,
  screen,
}) => {
  await guardOpenSeaHost(browser)

  // Connections only: no wallet is seeded, so the selection the second check
  // would complain about is empty.
  await app.open('/pnl/card')
  await seedVelox(browser, {
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/pnl/card')

  await screen
    .getByLabel(READ_COLLECTION_LABEL, { exact: true })
    .fill(`https://scatter.art/c/${SCATTER_SLUG}`)
  await screen.getByRole('button', { name: 'Check PnL' }).click()

  const toasts = browser.locator('[data-sonner-toast]')
  await expect(toasts.filter({ hasText: SCATTER_REFUSAL })).toBeVisible()
  await expect(toasts.filter({ hasText: 'Select a wallet first' })).toHaveCount(0)
})
