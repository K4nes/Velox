import { test } from '@e2e-dev/web'
import type { Browser, WebApp } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Screen } from 'e2e'
import {
  mintWallets,
  openseaConnection,
  robinhoodRpc,
  walletFolder,
} from '../support/data'
import {
  MINT_TEST_RPC_URL,
  SCATTER_NO_LIMIT,
  SCATTER_OPEN_END,
  mockMintNetwork,
  mockScatterNetwork,
} from '../support/mint'
import { seedVelox } from '../support/seed'
import type { FolderRow, WalletRow } from '../support/seed'

const SLUG = 'scatter-drop'
const URL_LABEL = 'Collection URL or slug (OpenSea / Scatter)'
const TOKEN_ADDRESS = '0x1111111111111111111111111111111111111111'

async function seedMintPage(
  app: WebApp,
  browser: Browser,
  folder: FolderRow,
  wallets: WalletRow[],
): Promise<void> {
  await browser.addInitScript(() => {
    try {
      window.localStorage.setItem('wallet-chain', 'robinhood')
    } catch {}
  })
  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [folder],
    wallets,
    connections: [
      robinhoodRpc(MINT_TEST_RPC_URL),
      openseaConnection('deterministic-key'),
    ],
  })
  await app.open('/mint/tasks')
}

async function selectFolder(
  browser: Browser,
  screen: Screen,
  folder: FolderRow,
): Promise<void> {
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
}

function oneWallet(folder: FolderRow): WalletRow {
  const wallet = mintWallets(1, folder.id)[0]
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')
  return wallet
}

test('a Scatter collection fills the picker and prices each list in its own currency', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Lists')
  const wallet = oneWallet(folder)
  const now = Date.now()

  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [
      {
        id: 'friends',
        name: 'Friends Discount',
        price: '0.5',
        currencySymbol: 'USDC',
        decimals: 6,
        startTime: new Date(now - 120_000).toISOString(),
        endTime: SCATTER_OPEN_END,
        walletLimit: SCATTER_NO_LIMIT,
      },
      {
        id: 'public',
        name: 'Public',
        price: '0.01',
        currencySymbol: 'ETH',
        decimals: 18,
        startTime: new Date(now - 60_000).toISOString(),
        endTime: new Date(now + 3_600_000).toISOString(),
        walletLimit: 5,
        unitSize: 5,
      },
    ],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The picker defaults to the live list and names it as the list is named.
  await expect(screen.getByLabel('Mint Stage')).toHaveText('Friends Discount')
  // The no-limit sentinel reads as no cap and never pre-fills the field.
  await expect(screen.getByText('No stated cap')).toBeVisible()
  await expect(screen.getByLabel('Quantity')).toHaveValue('1')
  // The price and the cost are read with the list's own symbol and decimals, not as
  // 18-decimal ETH.
  await expect(screen.getByText('0.5000 USDC')).toHaveCount(2)
  // The open-ended sentinel is not a date anywhere on the page.
  await expect(screen.getByText(/2106/)).toHaveCount(0)

  // Every list is offered under its own name, and the price follows the selection.
  await screen.getByLabel('Mint Stage').click()
  await expect(
    screen.getByRole('option', { name: 'Friends Discount' }),
  ).toBeVisible()
  await screen.getByRole('option', { name: 'Public' }).click()
  await expect(screen.getByLabel('Mint Stage')).toHaveText('Public')
  await expect(screen.getByText('0.0100 ETH').first()).toBeVisible()
  // 0.01 per unit × 5 units over one wallet.
  await expect(screen.getByText('0.0500 ETH')).toBeVisible()
  await expect(screen.getByLabel('Quantity')).toHaveValue('5')
  await expect(screen.getByText('Max 5 per wallet')).toBeVisible()

  expect(calls.collections).toEqual([SLUG])
  // One read lists the collection's stages; the other is the wallet's eligibility.
  expect(calls.lists).toHaveLength(2)
  expect(calls.lists[0]?.minter).toBeNull()
  expect(calls.lists[1]?.minter?.toLowerCase()).toBe(wallet.address.toLowerCase())
})

test('a Scatter token URL resolves the collection rather than the token', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Token')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [{ id: 'public', name: 'Public' }],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/12`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  await expect(screen.getByLabel('Mint Stage')).toHaveText('Public', {
    timeout: 60_000,
  })
  expect(calls.collections).toEqual([SLUG])
})

test('a collection on a chain Velox cannot sign for is refused by name before any list read', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Chain')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: 137,
    lists: [{ id: 'public', name: 'Public' }],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  await expect(
    browser.locator('[data-sonner-toast]').filter({ hasText: 'Polygon' }),
  ).toBeVisible({ timeout: 60_000 })
  expect(calls.lists).toHaveLength(0)
  await expect(screen.getByLabel('Mint Stage')).toHaveText(
    'Check a collection first',
  )
})

test('Start Mint refuses a Scatter task and names what is missing', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Start')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  await expect(
    screen.getByText(/cannot build a Scatter mint transaction/),
  ).toBeVisible()
  expect(calls.mints).toBe(0)
})

test('a bare slug and a contract address keep routing to OpenSea', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Route')
  const wallet = oneWallet(folder)
  const scatter = await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [{ id: 'public', name: 'Public' }],
  })
  await mockMintNetwork({
    browser,
    slug: SLUG,
    wallets: [{ address: wallet.address }],
  })

  await seedMintPage(app, browser, folder, [wallet])
  const row = screen.getByRole('row').filter({ hasText: wallet.address })

  await screen.getByLabel(URL_LABEL).fill(SLUG)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // A 40-hex address is a collection identifier, not a Scatter slug.
  await screen.getByLabel(URL_LABEL).fill(TOKEN_ADDRESS)
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  expect(scatter.collections).toHaveLength(0)
})
