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
  SCATTER_CONTRACT,
  SCATTER_NO_LIMIT,
  SCATTER_OPEN_END,
  mockMintNetwork,
  mockMintRpc,
  mockScatterNetwork,
  pinMintGas,
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
    } catch {
      // The chain is a preference, not a requirement: an origin that blocks storage
      // keeps the default chain.
    }
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

// Every Scatter collection in this suite is on Velox's Robinhood Chain, because the
// chain the drop carries is the one the mint request must state.
const SCATTER_CHAIN_ID = 4663

/** The ERC-20 both refusal tests name, so each can be checked against its address. */
const USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

/** Counts the OpenSea sign-in requests a task makes; a Scatter task must make none. */
async function countOpenSeaAuth(browser: Browser): Promise<{ calls: number }> {
  const calls = { calls: 0 }
  await browser.route('**/api/auth/**', async (route) => {
    calls.calls += 1
    await route.fulfill({
      status: 500,
      json: { error: 'a Scatter task has no OpenSea credential to warm' },
    })
  })
  return calls
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
  // The no-limit sentinel is not a quantity: the row names the absence.
  await expect(row.getByRole('cell').nth(2)).toHaveText('No cap')
  await expect(screen.getByText('9007199254740991')).toHaveCount(0)
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

test('a price below the printed precision never reads as free', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Tiny Price')
  const wallet = oneWallet(folder)
  const now = Date.now()

  await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [
      {
        id: 'tiny',
        name: 'Tiny Price',
        price: '0.00003',
        currencySymbol: 'ETH',
        decimals: 18,
        startTime: new Date(now - 60_000).toISOString(),
        endTime: SCATTER_OPEN_END,
        walletLimit: 1,
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

  // 0.00003 ETH rounds to four places as 0.0000, which would read as a free mint.
  await expect(screen.getByText('<0.0001 ETH').first()).toBeVisible()
  await expect(screen.getByText('0.0000 ETH')).toHaveCount(0)
})

test('a Scatter price follows the next stage when none is selected', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Future')
  const wallet = oneWallet(folder)
  const now = Date.now()

  await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [
      {
        id: 'future',
        name: 'Future',
        price: '0.5',
        currencySymbol: 'USDC',
        decimals: 6,
        startTime: new Date(now + 3_600_000).toISOString(),
        endTime: SCATTER_OPEN_END,
        walletLimit: 5,
      },
    ],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // No stage is selected, so the picker shows its placeholder and the price comes
  // from the next stage. It must still use that stage's currency and decimals.
  await expect(screen.getByLabel('Mint Stage')).toHaveText('Select a stage')
  await expect(screen.getByText('0.5000 USDC').first()).toBeVisible()
  await expect(screen.getByText('0 USDC')).toBeVisible()
  await expect(screen.getByText('0.0000 ETH')).toHaveCount(0)
})

test('an unnamed Scatter token keeps its decimals instead of reading as ETH', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Unnamed')
  const wallet = oneWallet(folder)
  const now = Date.now()

  await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [
      {
        id: 'unnamed',
        name: 'Unnamed Token',
        price: '0.5',
        currencySymbol: '',
        currencyAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        decimals: 6,
        startTime: new Date(now - 60_000).toISOString(),
        endTime: SCATTER_OPEN_END,
        walletLimit: 1,
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

  // A 6-decimal token with no ticker is named by address. Reading its base units as
  // 18-decimal ETH would show 0.0000 ETH for a 0.5 price.
  await expect(screen.getByText('0.5000 0x8335…2913')).toHaveCount(2)
  await expect(screen.getByText('0.0000 ETH')).toHaveCount(0)
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

test('a native Scatter list mints across the selected wallets and every row reaches Confirmed', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Mint')
  const wallets = mintWallets(2, folder.id)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', price: '0.01', walletLimit: 1 }],
  })
  const rpc = await mockMintRpc({ browser, wallets })
  const auth = await countOpenSeaAuth(browser)

  await seedMintPage(app, browser, folder, wallets)
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const [first] = wallets
  if (first === undefined) throw new Error('mintWallets(2) returned no wallet')
  const row = screen.getByRole('row').filter({ hasText: first.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()

  await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(2, {
    timeout: 60_000,
  })

  // One build per wallet, each naming the collection, the chain, the minter, the list
  // and the quantity. Scatter reads quantity inside the list entry, not on top.
  expect(calls.mintBodies).toHaveLength(2)
  expect(
    calls.mintBodies.map((body) => body.minterAddress?.toLowerCase()).sort(),
  ).toEqual(wallets.map((wallet) => wallet.address.toLowerCase()).sort())
  for (const body of calls.mintBodies) {
    expect(body.collectionAddress).toBe(SCATTER_CONTRACT)
    expect(body.chainId).toBe(SCATTER_CHAIN_ID)
    expect(body.lists).toEqual([{ id: 'public', quantity: 1 }])
  }

  // Every build was signed locally: one send per wallet, and no OpenSea credential was
  // asked for on the way.
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(2)
  expect(auth.calls).toBe(0)
})

test('an ERC-20 priced Scatter list refuses with the token and amount named', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Token Price')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [
      {
        id: 'usdc',
        name: 'USDC List',
        price: '0.5',
        currencySymbol: 'USDC',
        currencyAddress: USDC_ADDRESS,
        decimals: 6,
        walletLimit: 1,
      },
    ],
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The list states its currency, so the refusal arrives before any wallet is built
  // for: the panel names the token and its price, and Start stays refused.
  const refusal = screen.getByRole('alert')
  await expect(refusal).toContainText('0.5000 USDC')
  await expect(refusal).toContainText('0x8335…2913')
  await expect(refusal).toContainText('Velox mints native-currency lists only')
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  expect(calls.mintBodies).toHaveLength(0)
  expect(rpc.events).toHaveLength(0)
})

test('an allowance answer from one wallet stops the batch before any wallet signs', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Batch Allowance')
  // Three wallets, because the run builds two at a time: the third is the one a refusal
  // has to stop from being built at all, and a two-wallet run cannot show that.
  const wallets = mintWallets(3, folder.id)
  const [first, second] = wallets
  if (!first || !second) throw new Error('mintWallets(3) returned too few')
  // The list states the native currency, so only a build can tell that this mint is
  // priced in a token, and only the second wallet's build does.
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    mint: (body) =>
      body.minterAddress?.toLowerCase() === second.address.toLowerCase()
        ? { erc20s: [{ address: USDC_ADDRESS, amount: '5000000' }] }
        : {},
  })
  const rpc = await mockMintRpc({ browser, wallets })

  await seedMintPage(app, browser, folder, wallets)
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: first.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await screen.getByRole('button', { name: 'Start Mint' }).click()

  // The refusal belongs to the task, so every row stops and no wallet signs.
  await expect(screen.getByText('Blocked', { exact: true })).toHaveCount(3, {
    timeout: 60_000,
  })
  await expect(row).toContainText('5000000 base units of 0x8335…2913')
  await expect(row).toContainText('Velox mints native-currency lists only')
  // Two builds were read before the refusal landed, and the third was never built.
  expect(calls.mintBodies).toHaveLength(2)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
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
