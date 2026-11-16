import { test } from '@e2e-dev/web'
import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, walletFolder } from '../support/data'
import {
  SCATTER_OPEN_END,
  mockMintNetwork,
  mockScatterNetwork,
  oneWallet,
  seedMintPage,
  selectFolder,
  summaryBox,
  summaryValue,
} from '../support/mint'
import type { ScatterList } from '../support/mint'

const OPENSEA_SLUG = 'summary-drop'
const SCATTER_SLUG = 'summary-scatter'
const URL_LABEL = 'Collection URL or slug (OpenSea / Scatter)'
const PUBLIC_LIST: ScatterList = {
  id: 'public',
  name: 'Public',
  price: '0.01',
  currencySymbol: 'ETH',
  decimals: 18,
  startTime: new Date(Date.now() - 60_000).toISOString(),
  endTime: SCATTER_OPEN_END,
  walletLimit: 1,
  unitSize: 5,
}

async function expectSummary(
  browser: Browser,
  totalLabel: string,
  unitPrice: string,
  totalNfts: string,
  estimatedCost: string,
): Promise<void> {
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await expect(summaryBox(browser)).toContainText(
    new RegExp(
      [
        'Quantity per Wallet',
        '1',
        'Unit Price',
        unitPrice,
        totalLabel,
        totalNfts,
        'Estimated Cost',
        estimatedCost,
      ]
        .map(escape)
        .join('\\s*')
    )
  )
}

test('the OpenSea summary names every scope and closes at 20', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Summary OpenSea')
  const wallets = mintWallets(20, folder.id)

  await mockMintNetwork({
    browser,
    slug: OPENSEA_SLUG,
    wallets,
    maxPerWallet: '1',
    priceWei: '10000000000000000',
  })

  await seedMintPage(app, browser, folder, wallets)
  await screen
    .getByLabel(URL_LABEL)
    .fill(`https://opensea.io/collection/${OPENSEA_SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  await expect(screen.getByText('Eligible', { exact: true })).toHaveCount(20, {
    timeout: 60_000,
  })
  await expectSummary(
    browser,
    'Total NFTs (20 Wallets)',
    '0.0100 ETH',
    '20',
    '0.2000 ETH'
  )
})

test('the Scatter summary names every scope and closes at 100', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Summary Scatter')
  const wallets = mintWallets(20, folder.id)

  await mockScatterNetwork({
    browser,
    slug: SCATTER_SLUG,
    lists: [PUBLIC_LIST],
  })

  await seedMintPage(app, browser, folder, wallets)
  await screen
    .getByLabel(URL_LABEL)
    .fill(`https://scatter.art/c/${SCATTER_SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  await expect(screen.getByText('Eligible', { exact: true })).toHaveCount(20, {
    timeout: 60_000,
  })
  await expectSummary(
    browser,
    'Total NFTs (20 Wallets)',
    '0.0100 ETH',
    '100',
    '0.2000 ETH'
  )
})

test('a failed re-check clears the NFT total instead of pricing the old rows', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Summary Failed')
  const wallet = oneWallet(folder)

  await mockScatterNetwork({
    browser,
    slug: SCATTER_SLUG,
    lists: [PUBLIC_LIST],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen
    .getByLabel(URL_LABEL)
    .fill(`https://scatter.art/c/${SCATTER_SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  await expect(screen.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await browser.route(
    /api\.scatter\.art\/v1\/collection\/[^/?]+$/,
    async (route) => {
      await route.fulfill({
        status: 500,
        json: { error: 'Scatter collection read failed' },
      })
    }
  )
  await screen.getByRole('button', { name: 'Check' }).click()

  await expect(summaryValue(browser, 'Total NFTs (1 Wallet)')).toHaveText('—')
})
