import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { RH8_FOLDER, mintWallets, openseaConnection } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture } from '../support/fixtures/holdings'
import { mockCollection, mockHoldings } from '../support/opensea'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'bulk-sell-mock'
const CONTRACT = '0x00000000000000000000000000000000000000bb'
const CHAIN = 'robinhood'

test('selection and price gate the listing run', async ({
  app,
  browser,
  screen,
}) => {
  // The wallet is generated per run; the test never signs, so no key is stored
  // beyond the one this run made.
  const [wallet] = mintWallets(1)

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
    body: holdingsFixture([
      { contract: CONTRACT, identifier: '1', name: 'Mock #1' },
    ]),
  })

  await app.open('/bulk-sell')
  await seedVelox(browser, {
    folders: [RH8_FOLDER],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/bulk-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'bulk-sell',
    collection: SLUG,
  })

  const row = screen.getByRole('row').filter({ hasText: 'Mock #1' })
  await expect(row.getByText('#1', { exact: true })).toBeVisible()
  await expect(screen.getByRole('row')).toHaveCount(2)

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
})
