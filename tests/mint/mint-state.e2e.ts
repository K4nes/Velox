import { test } from '@e2e-dev/web'
import type { Browser, WebApp } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, openseaConnection, robinhoodRpc, walletFolder } from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsSpread } from '../support/fixtures/holdings'
import { MINT_TEST_RPC_URL, mockMintNetwork, pinMintGas } from '../support/mint'
import { mockCollection, mockHoldings } from '../support/opensea'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'
import type { FolderRow, WalletRow } from '../support/seed'

const SLUG = 'state-drop'
const STAGE_UUID = 'parallel-stage'
const MINT_CONTRACT = '0x1111111111111111111111111111111111111111'
const BULK_SLUG = 'state-bulk-sell'
const BULK_CONTRACT = '0x00000000000000000000000000000000000000bb'
const CHAIN = 'robinhood'
const URL_LABEL = 'Collection URL or slug (OpenSea / Scatter)'

async function seedMintPage(
  app: WebApp,
  browser: Browser,
  folder: FolderRow,
  wallet: WalletRow,
): Promise<void> {
  await browser.addInitScript(() => {
    try {
      window.localStorage.setItem('wallet-chain', 'robinhood')
    } catch {}
  })
  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [
      robinhoodRpc(MINT_TEST_RPC_URL),
      openseaConnection('deterministic-key'),
    ],
  })
  await app.open('/mint/tasks')
}

test('the mint task survives a round trip while the check is running', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint State')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await mockMintNetwork({
    browser,
    slug: SLUG,
    wallets: [{ address: wallet.address }],
  })

  // Holds the eligibility answer, so the check is still in flight while the
  // operator visits another page.
  const released = Promise.withResolvers<void>()
  await browser.route(/\/api\/v2\/drops\/[^/]+\/eligibility$/, async (route) => {
    await released.promise
    await route.fulfill({
      status: 200,
      json: {
        stages: [
          {
            stage_uuid: STAGE_UUID,
            is_eligible: true,
            max_total_mintable_by_wallet: '1',
            price: '0',
          },
        ],
      },
    })
  })

  await seedMintPage(app, browser, folder, wallet)

  await screen.getByLabel(URL_LABEL).fill(`https://opensea.io/collection/${SLUG}`)
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(screen.getByRole('button', { name: /Check/ })).toBeDisabled()

  await browser.locator('a[href="/settings"]').first().click()
  await expect(screen.getByLabel(URL_LABEL)).toHaveCount(0)
  await browser.locator('a[href="/mint/tasks"]').first().click()
  await expect(browser).toHaveURL('/mint/tasks')

  await expect(screen.getByLabel(URL_LABEL)).toHaveValue(
    `https://opensea.io/collection/${SLUG}`,
  )
  await expect(
    screen.getByRole('button', { name: /Select wallets/ }),
  ).toHaveText('Select wallets (1 selected)')
  // The check kept running through the route change instead of being dropped.
  await expect(screen.getByRole('button', { name: /Check/ })).toBeDisabled()

  released.resolve()
  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible()

  await screen.getByLabel('Quantity').fill('1')
  await pinMintGas(screen)
  await expect(screen.getByLabel('Max Fee (Gwei)')).toHaveValue('1')

  await browser.locator('a[href="/settings"]').first().click()
  await browser.locator('a[href="/mint/tasks"]').first().click()

  await expect(screen.getByLabel(URL_LABEL)).toHaveValue(
    `https://opensea.io/collection/${SLUG}`,
  )
  await expect(
    screen.getByRole('row').filter({ hasText: wallet.address }),
  ).toContainText('Eligible')
  await expect(screen.getByLabel('Quantity')).toHaveValue('1')
  await expect(screen.getByLabel('Max Fee (Gwei)')).toHaveValue('1')
})

test('a mint run blocks another batch flow and keeps reporting across pages', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Slot')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await mockMintNetwork({
    browser,
    slug: SLUG,
    wallets: [{ address: wallet.address }],
  })
  await seedMintPage(app, browser, folder, wallet)

  await screen.getByLabel(URL_LABEL).fill(`https://opensea.io/collection/${SLUG}`)
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
  await screen.getByRole('button', { name: 'Check' }).click()
  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await screen.getByLabel('Quantity').fill('1')
  await pinMintGas(screen)

  // Holds the mint calldata so the run is still signing when the operator
  // leaves for another page.
  const released = Promise.withResolvers<void>()
  await browser.route(/\/api\/v2\/drops\/[^/]+\/mint$/, async (route) => {
    await released.promise
    await route.fulfill({
      status: 200,
      json: {
        chain: CHAIN,
        to: MINT_CONTRACT,
        data: '0x12345678',
        value: '0',
      },
    })
  })

  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row).toContainText('Minting')

  await mockCollection(browser, {
    slug: BULK_SLUG,
    body: collectionFixture({
      slug: BULK_SLUG,
      name: 'Mock Collection',
      contract: BULK_CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsSpread(BULK_CONTRACT, 2),
  })

  await browser.locator('a[href="/bulk-sell"]').first().click()
  await scanCollection({
    browser,
    screen,
    feature: 'bulk-sell',
    collection: BULK_SLUG,
    folder: folder.name,
  })
  await expect(screen.getByRole('row')).toHaveCount(3)

  await screen.getByRole('checkbox', { name: 'Select token #1' }).click()
  await screen.getByLabel('Price per item · ETH').fill('0.01')
  await screen.getByRole('button', { name: 'Create listings' }).click()
  await expect(
    browser
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'A mint run is still in progress' }),
  ).toBeVisible()

  await browser.locator('a[href="/mint/tasks"]').first().click()
  await expect(browser).toHaveURL('/mint/tasks')
  // The run kept its row and its status while the page was gone.
  await expect(
    screen.getByRole('row').filter({ hasText: wallet.address }),
  ).toContainText('Minting')

  released.resolve()
  await expect(
    screen.getByRole('row').filter({ hasText: wallet.address }),
  ).toContainText('Confirmed', { timeout: 60_000 })
})
