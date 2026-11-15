import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { guardOpenSeaHost, mockCollection } from '../support/opensea'
import { COLLECTION_LABEL, scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SCATTER_SLUG = 'scatter-pnl-card'
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
    .getByLabel(COLLECTION_LABEL)
    .fill(`https://scatter.art/c/${SCATTER_SLUG}/42`)
  await screen.getByRole('button', { name: 'Check PnL' }).click()
  await expect(refusal).toHaveCount(2)

  expect(collection.count).toBe(0)
})
