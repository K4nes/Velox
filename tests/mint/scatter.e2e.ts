import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Screen } from 'e2e'
import { mintWallets, walletFolder } from '../support/data'
import {
  SCATTER_CONTRACT,
  SCATTER_NO_LIMIT,
  SCATTER_OPEN_END,
  checkCollection,
  mockMintNetwork,
  mockMintRpc,
  mockScatterNetwork,
  oneWallet,
  pinMintGas,
  seedMintPage,
  selectFolder,
} from '../support/mint'
import {
  applyProbeVerdicts,
  blockedReason,
  createTask,
  mintableRow,
  reasonFor,
  stageStatusFor,
  startRefusalFor,
} from '@/lib/mint/mint-task'
import type { WalletRun } from '@/lib/mint/mint-task'
import { ScatterError } from '@/lib/scatter/error'
import { isMissingTokenIdRefusal } from '@/lib/scatter/probe'

const SLUG = 'scatter-drop'
const URL_LABEL = 'Collection URL or slug (OpenSea / Scatter)'
const TOKEN_ADDRESS = '0x1111111111111111111111111111111111111111'

async function openExecutionLog(screen: Screen, walletAddress: string) {
  await screen
    .getByRole('button', { name: `Show execution log for ${walletAddress}` })
    .click()
  const log = screen.getByRole('dialog')
  await expect(log.getByText('Execution log')).toBeVisible()
  return log
}


// Every Scatter collection in this suite is on Velox's Robinhood Chain, because the
// chain the drop carries is the one the mint request must state.
const SCATTER_CHAIN_ID = 4663

type RecordedMintBuild = {
  body: {
    erc20s?: { address: string; amount: string }[]
    listPayments?: {
      currencyAddress: string
      currencySymbol: string
      currencyDecimals: number
      unitPaymentValue: string
    }[]
  }
}

// The allowance a real ERC-20 build answered with, shared by every allowance test.
const recordedMintBuild: RecordedMintBuild = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'contract', 'scatterMintErc20.json'),
    'utf8'
  )
)

const RECORDED_ALLOWANCE = recordedMintBuild.body.erc20s?.[0]
if (RECORDED_ALLOWANCE === undefined) {
  throw new Error('the recorded ERC-20 build has no allowance')
}
const RECORDED_TOKEN = RECORDED_ALLOWANCE.address
// The build's own display metadata: the only source for the token's symbol and decimals.
const RECORDED_LIST_PAYMENTS = recordedMintBuild.body.listPayments ?? []

// The two `eth_call` selectors Check may read: ERC-20 balanceOf and allowance.
const allowanceReads = (calls: { selector: string }[]) =>
  calls.filter(
    (call) => call.selector === '0x70a08231' || call.selector === '0xdd62ed3e'
  )

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
  // Selecting the second live list reads the chain clock before probing it.
  await mockMintRpc({ browser, wallets: [wallet], nowMs: now })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

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
  await expect(
    screen.getByText('Up to 5 per wallet, 5 NFTs per unit')
  ).toBeVisible()

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
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // 0.00003 ETH rounds to four places as 0.0000, which would read as a free mint.
  await expect(screen.getByText('<0.0001 ETH').first()).toBeVisible()
  await expect(screen.getByText('0.0000 ETH')).toHaveCount(0)
})

test('a Scatter price follows the next stage, and a future list is not probed', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Future')
  const wallet = oneWallet(folder)
  const now = Date.now()

  const calls = await mockScatterNetwork({
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
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // There is no live list, so Check issues no build at all.
  expect(calls.mintBodies).toHaveLength(0)

  // No stage is selected, so the picker shows its placeholder and the price comes
  // from the next stage. It must still use that stage's currency and decimals.
  await expect(screen.getByLabel('Mint Stage')).toHaveText('Select a stage')
  await expect(screen.getByText('0.5000 USDC').first()).toBeVisible()
  await expect(screen.getByText('0 USDC')).toBeVisible()
  await expect(screen.getByText('0.0000 ETH')).toHaveCount(0)

  // Selecting the future list still issues no build, and the row stays Scheduled.
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Future' }).click()
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible()
  expect(calls.mintBodies).toHaveLength(0)
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
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // A 6-decimal token with no ticker is named by address. Reading its base units as
  // 18-decimal ETH would show 0.0000 ETH for a 0.5 price.
  await expect(screen.getByText('0.5000 0x8335…2913')).toHaveCount(2)
  await expect(screen.getByText('0.0000 ETH')).toHaveCount(0)
})

test('a Scatter token URL fills the Token ID field', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Token Fill')
  const wallet = oneWallet(folder)

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/12`)

  await expect(screen.getByLabel('Token ID')).toHaveValue('12')
})

test('the URL token reaches the mint request body', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Token Body')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [{ id: 'public', name: 'Public' }],
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}/12`
  )

  await expect(screen.getByLabel('Mint Stage')).toHaveText('Public', {
    timeout: 60_000,
  })
  // Check already asked for one free build against this token.
  const probed = calls.mintBodies.length
  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(1, {
    timeout: 60_000,
  })

  // The token the URL filled is the token the request names.
  expect(calls.mintBodies).toHaveLength(probed + 1)
  expect(calls.mintBodies.at(-1)?.lists).toEqual([
    { id: 'public', quantity: 1, tokenId: 12 },
  ])
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(1)
})

test('a token page token does not follow the task to another collection', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Retarget')
  const wallet = oneWallet(folder)

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/12`)
  await screen.getByLabel(URL_LABEL).fill('https://scatter.art/c/other-collection')
  await expect(screen.getByLabel('Token ID')).toHaveValue('')
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
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  await expect(
    browser.locator('[data-sonner-toast]').filter({ hasText: 'Polygon' }),
  ).toBeVisible({ timeout: 60_000 })
  expect(calls.lists).toHaveLength(0)
  await expect(screen.getByLabel('Mint Stage')).toHaveText(
    'Check a collection first',
  )
})

test('an ERC-721 Scatter list mints across the selected wallets and every row reaches Confirmed', async ({
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
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const [first] = wallets
  if (first === undefined) throw new Error('mintWallets(2) returned no wallet')
  const row = screen.getByRole('row').filter({ hasText: first.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // An ERC-721 task holds no token, and the field states that rather than guessing one.
  await expect(screen.getByLabel('Token ID')).toHaveValue('')

  // Check already asked for one free build per wallet, at quantity 1 and against the
  // selected list, before Start was pressed.
  expect(calls.mintBodies).toHaveLength(2)
  expect(
    calls.mintBodies.map((body) => body.minterAddress?.toLowerCase()).sort(),
  ).toEqual(wallets.map((wallet) => wallet.address.toLowerCase()).sort())
  for (const body of calls.mintBodies) {
    expect(body.lists).toEqual([{ id: 'public', quantity: 1 }])
  }
  const probed = calls.mintBodies.length

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()

  await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(2, {
    timeout: 60_000,
  })

  // The run builds one more per wallet, each naming the collection, the chain, the
  // minter, the list and the quantity. Scatter reads quantity inside the list entry,
  // not on top.
  expect(calls.mintBodies).toHaveLength(probed + 2)
  expect(
    calls.mintBodies
      .slice(probed)
      .map((body) => body.minterAddress?.toLowerCase())
      .sort(),
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

test('a typed token survives a collection URL edit', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter URL Keep')
  const wallet = oneWallet(folder)

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await screen.getByLabel('Token ID').fill('12')
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/`)

  await expect(screen.getByLabel('Token ID')).toHaveValue('12')
})

test('a typed Scatter token ID mints the edition named in the request body', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Edition')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'edition', name: 'Edition', price: '0.01', walletLimit: 1 }],
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  // The collection URL states no token, so the typed field is the only source.
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await screen.getByLabel('Token ID').fill('12')
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const probed = calls.mintBodies.length

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()

  await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(1, {
    timeout: 60_000,
  })

  // The typed ID reaches the list entry Scatter mints from, and the mint lands.
  expect(calls.mintBodies).toHaveLength(probed + 1)
  expect(calls.mintBodies.at(-1)?.lists).toEqual([
    { id: 'edition', quantity: 1, tokenId: 12 },
  ])
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(1)
})

test('changing the Token ID clears the previous verdict', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Retoken')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/12`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const probed = calls.mintBodies.length

  await screen.getByLabel('Token ID').fill('13')

  // The verdict named token 12, so it cannot survive the change; the task asks for a
  // fresh check instead of carrying that row to token 13.
  await expect(screen.getByText('Eligible', { exact: true })).toHaveCount(0)
  // Changing the token does not build; only the earlier Check did.
  expect(calls.mintBodies).toHaveLength(probed)
})

test('a token change keeps the stage the operator picked', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Stage Pick')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    lists: [
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
    ],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/12`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // Alpha is the live default; the operator picks the other list.
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Beta' }).click()
  await screen.getByLabel('Token ID').fill('13')
  await screen.getByRole('button', { name: 'Check' }).click()

  await expect(screen.getByLabel('Mint Stage')).toHaveText('Beta', {
    timeout: 60_000,
  })
})

test('a confirmed landing keeps its hash after a token change', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Landing')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', price: '0.01', walletLimit: 1 }],
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/12`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row).toContainText('Eligible')

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(1, {
    timeout: 60_000,
  })

  await screen.getByLabel('Token ID').fill('13')

  // The transaction is a chain fact: changing the edition keeps its hash and the
  // stage it retired instead of hiding the landing.
  await expect(row.getByRole('link', { name: /Tx Hash/ })).toBeVisible()
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(1)
})

test('a reverted send does not retire the wallet for the new token', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Revert')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', price: '0.01', walletLimit: 1 }],
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    revert: true,
  })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}/12`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row).toContainText('Eligible')

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await screen.getByLabel('Token ID').fill('13')

  // A reverted send is not a landing, so it must not follow the task to token 13.
  await expect(screen.getByText('Failed', { exact: true })).toHaveCount(0)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(1)
})

test('an ERC-20 priced Scatter list marks the row eligible after reading balance and allowance', async ({
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
        id: 'basecat',
        name: 'Basecat List',
        price: '20',
        currencySymbol: 'Basecat',
        currencyAddress: RECORDED_TOKEN,
        decimals: 18,
        walletLimit: 1,
      },
    ],
    mint: {
      erc20s: [RECORDED_ALLOWANCE],
      listPayments: RECORDED_LIST_PAYMENTS,
    },
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    tokenBalances: [
      { token: RECORDED_TOKEN, owner: wallet.address, balance: '25000000000000000000' },
    ],
    tokenAllowances: [
      {
        token: RECORDED_TOKEN,
        owner: wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: '20000000000000000000',
      },
    ],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The build names the token and the wallet covers both reads, so Start is offered.
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
  // Check sends nothing; the only chain traffic is the two view reads.
  expect(allowanceReads(rpc.calls)).toHaveLength(2)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)

  // The Cost panel prices the task in the build's token, not the stage's ETH.
  await expect(screen.getByText('20 Basecat')).toHaveCount(2)
  await expect(screen.getByText(/ETH/)).toHaveCount(0)

  // One free build per wallet at quantity 1.
  expect(calls.mintBodies).toHaveLength(1)
  expect(calls.mintBodies[0]?.lists).toEqual([{ id: 'basecat', quantity: 1 }])
})

test('a build allowance answer marks that row Needs approval and disables Start before any wallet signs', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Batch Allowance')
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
        ? {
            erc20s: [RECORDED_ALLOWANCE],
            listPayments: RECORDED_LIST_PAYMENTS,
          }
        : {},
  })
  const rpc = await mockMintRpc({
    browser,
    wallets,
    tokenBalances: [
      { token: RECORDED_TOKEN, owner: second.address, balance: '25000000000000000000' },
    ],
    tokenAllowances: [
      {
        token: RECORDED_TOKEN,
        owner: second.address,
        spender: SCATTER_CONTRACT,
        allowance: '0',
      },
    ],
  })

  await seedMintPage(app, browser, folder, wallets)
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const firstRow = screen.getByRole('row').filter({ hasText: first.address })
  const approvalRow = screen.getByRole('row').filter({ hasText: second.address })
  await expect(firstRow.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(
    approvalRow.getByText('Needs approval', { exact: true })
  ).toBeVisible()

  // The log names the token, its amount, the spender, the balance and the allowance.
  const log = await openExecutionLog(screen, second.address)
  await expect(log).toContainText('20 Basecat')
  await expect(log).toContainText('20000000000000000000 base units')
  await expect(log).toContainText('Basecat')
  await expect(log).toContainText('decimals 18')
  await expect(log).toContainText(`Spender ${SCATTER_CONTRACT}`)
  await expect(log).toContainText('Wallet balance 25000000000000000000')
  await expect(log).toContainText('wallet allowance 0')
  await expect(log).toContainText('short by')
  await browser.keyboard.press('Escape')

  // One build per wallet was read, so the verdict stays on the row that caused it.
  expect(calls.mintBodies).toHaveLength(3)
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
})

test('a wallet short of the token is Blocked and names the shortfall', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Token Shortfall')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    mint: {
      erc20s: [RECORDED_ALLOWANCE],
      listPayments: RECORDED_LIST_PAYMENTS,
    },
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    tokenBalances: [
      { token: RECORDED_TOKEN, owner: wallet.address, balance: '5000000000000000000' },
    ],
    tokenAllowances: [
      {
        token: RECORDED_TOKEN,
        owner: wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: '20000000000000000000',
      },
    ],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Blocked', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // A balance below the token amount outranks the allowance question.
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('short by')
  await expect(log).toContainText('15 Basecat')
  await browser.keyboard.press('Escape')

  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  expect(rpc.events).toHaveLength(0)
})

test('an allowance whose token cannot be resolved blocks without a chain read', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Token Unresolved')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    mint: { erc20s: [{ address: '', amount: '1' }] },
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Blocked', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // An unreadable requirement is a task block, so nothing is read from the chain.
  expect(allowanceReads(rpc.calls)).toHaveLength(0)
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  expect(rpc.events).toHaveLength(0)
})

test('a native list reads neither balance nor allowance', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Native Reads')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    mint: {},
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // The native path keeps its old shape: no allowance read, no send.
  expect(allowanceReads(rpc.calls)).toHaveLength(0)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
})

test('a native stage whose build is token-priced shows the build token in the cost panel', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Native Stage Token Build')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', price: '0.01', walletLimit: 1 }],
    mint: {
      erc20s: [RECORDED_ALLOWANCE],
      listPayments: RECORDED_LIST_PAYMENTS,
    },
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    tokenBalances: [
      { token: RECORDED_TOKEN, owner: wallet.address, balance: '25000000000000000000' },
    ],
    tokenAllowances: [
      {
        token: RECORDED_TOKEN,
        owner: wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: '20000000000000000000',
      },
    ],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // The build's own payment metadata outranks the stage's native price.
  await expect(screen.getByText('20 Basecat')).toHaveCount(2)
  await expect(screen.getByText('0.0100 ETH')).toHaveCount(0)
  expect(allowanceReads(rpc.calls)).toHaveLength(2)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
})

test('a Needs approval row disables arming on an open list the provider did not mark active', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Arm Approval')
  const wallet = oneWallet(folder)
  const now = Date.now()
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [
      {
        id: 'first',
        name: 'First',
        price: '0.01',
        walletLimit: 1,
        startTime: new Date(now - 120_000).toISOString(),
        endTime: SCATTER_OPEN_END,
      },
      {
        id: 'second',
        name: 'Second',
        price: '0.01',
        walletLimit: 1,
        startTime: new Date(now - 60_000).toISOString(),
        endTime: SCATTER_OPEN_END,
      },
    ],
    mint: (body) =>
      body.lists?.[0]?.id === 'second'
        ? {
            erc20s: [RECORDED_ALLOWANCE],
            listPayments: RECORDED_LIST_PAYMENTS,
          }
        : {},
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    tokenBalances: [
      {
        token: RECORDED_TOKEN,
        owner: wallet.address,
        balance: '25000000000000000000',
      },
    ],
    tokenAllowances: [
      {
        token: RECORDED_TOKEN,
        owner: wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: '0',
      },
    ],
    nowMs: now,
  })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()

  // The second list is open by its own window but is not the provider's active list,
  // so the same button arms instead of starting. Its allowance verdict still gates it.
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Second' }).click()
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  await expect(screen.getByText('Mint opens in')).toHaveCount(0)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
})

test('a missing token ID refusal blocks the row with the provider wording', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Token ID')
  const wallet = oneWallet(folder)
  const callMessage = 'Token ID is required for this collection'
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    refuseMint: () => ({
      status: 422,
      body: { error: callMessage },
    }),
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Blocked', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // The log carries the provider's own wording, not a rewrite.
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(callMessage)
  await browser.keyboard.press('Escape')
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()

  expect(calls.mintBodies).toHaveLength(1)
  expect(calls.mintBodies[0]?.lists).toEqual([{ id: 'public', quantity: 1 }])
  expect(rpc.events).toHaveLength(0)
})

test('any other build refusal marks the row failed with its message', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Build Failure')
  const wallet = oneWallet(folder)
  const message = 'Scatter build failed'
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    refuseMint: () => ({ status: 500, body: { error: message } }),
  })
  const rpc = await mockMintRpc({ browser, wallets: [wallet] })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(message)
  await browser.keyboard.press('Escape')
  // A failed probe may be transient. The run's own build retries it, so Start stays
  // offered; only a blocked probe refuses the start.
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
  expect(rpc.events).toHaveLength(0)
})

test('changing the Mint Stage clears the verdict and probes the new list', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Stage Probe')
  const wallet = oneWallet(folder)
  const now = Date.now()
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [
      {
        id: 'first',
        name: 'First',
        price: '0.01',
        walletLimit: 1,
        startTime: new Date(now - 120_000).toISOString(),
        endTime: SCATTER_OPEN_END,
      },
      {
        id: 'second',
        name: 'Second',
        price: '0.01',
        walletLimit: 1,
        startTime: new Date(now - 60_000).toISOString(),
        endTime: SCATTER_OPEN_END,
      },
    ],
    mintDelayMs: 400,
    mint: (body) =>
      body.lists?.[0]?.id === 'second'
        ? {
            erc20s: [RECORDED_ALLOWANCE],
            listPayments: RECORDED_LIST_PAYMENTS,
          }
        : {},
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    tokenBalances: [
      { token: RECORDED_TOKEN, owner: wallet.address, balance: '25000000000000000000' },
    ],
    tokenAllowances: [
      {
        token: RECORDED_TOKEN,
        owner: wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: '0',
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
  expect(calls.mintBodies).toHaveLength(1)
  expect(calls.mintBodies[0]?.lists).toEqual([{ id: 'first', quantity: 1 }])
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()

  // A new list clears the old verdict and gets its own probe. Start waits for the
  // verdict instead of re-opening on the stale rows.
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Second' }).click()
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  expect(calls.mintBodies).toHaveLength(2)
  expect(calls.mintBodies[1]?.lists).toEqual([{ id: 'second', quantity: 1 }])
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()

  // Back to the first list: the second list's verdict must not stick.
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'First' }).click()
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  expect(calls.mintBodies).toHaveLength(3)
  expect(calls.mintBodies[2]?.lists).toEqual([{ id: 'first', quantity: 1 }])
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
  expect(rpc.events).toHaveLength(0)
})

test('a successful build lifts a failed list read', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Recovered Read')
  const wallet = oneWallet(folder)
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    failMinters: [wallet.address],
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
  await expect(row.getByRole('cell').nth(2)).toHaveText('No cap')
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
  await expect(
    screen.getByRole('button', {
      name: `Show execution log for ${wallet.address}`,
    })
  ).toHaveCount(0)
  expect(calls.mintBodies).toHaveLength(1)
  expect(rpc.events).toHaveLength(0)
})

test('a stage change during Check wins and releases the probe hold', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter During Check')
  const wallet = oneWallet(folder)
  const now = Date.now()
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [
      {
        id: 'first',
        name: 'First',
        price: '0.01',
        walletLimit: 1,
        startTime: new Date(now - 120_000).toISOString(),
        endTime: SCATTER_OPEN_END,
      },
      {
        id: 'second',
        name: 'Second',
        price: '0.01',
        walletLimit: 1,
        startTime: new Date(now - 60_000).toISOString(),
        endTime: SCATTER_OPEN_END,
      },
    ],
    mintDelayMs: 400,
  })
  await mockMintRpc({ browser, wallets: [wallet], nowMs: now })

  await seedMintPage(app, browser, folder, [wallet])
  await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${SLUG}`)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByLabel('Mint Stage')).toHaveText('First')

  // Re-check, then move the picker before the second probe settles.
  await screen.getByRole('button', { name: 'Check' }).click()
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Second' }).click()

  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByLabel('Mint Stage')).toHaveText('Second')
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
  expect(calls.mintBodies.at(-1)?.lists).toEqual([{ id: 'second', quantity: 1 }])
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

  await checkCollection(browser, screen, folder, SLUG)
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // The field belongs to Scatter only, so the OpenSea card gains no control.
  await expect(screen.getByLabel('Token ID')).toHaveCount(0)

  // A 40-hex address is a collection identifier, not a Scatter slug.
  await screen.getByLabel(URL_LABEL).fill(TOKEN_ADDRESS)
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  expect(scatter.collections).toHaveLength(0)
})

test('a run block belongs to the list it was taken against', () => {
  const row: WalletRun = {
    walletId: 'wallet-1',
    label: 'Wallet 1',
    address: '0x0000000000000000000000000000000000000001',
    caps: { public: 1, other: 1 },
    status: 'blocked',
    statusStage: 'public',
    error: 'This Scatter list needs an ERC-20 allowance',
    mintedStages: [],
    probe: null,
  }

  // The batch never takes the blocked row on the list that blocked it.
  expect(mintableRow(row, 'public')).toBe(false)
  expect(blockedReason(row, 'public')).toBe(row.error ?? null)

  // The same row is free to mint on another list, and the old reason does not leak.
  expect(mintableRow(row, 'other')).toBe(true)
  expect(blockedReason(row, 'other')).toBeNull()

  // A failed probe may be transient, so it stays in the batch for the run to retry.
  const failed: WalletRun = {
    ...row,
    status: 'eligible',
    statusStage: 'public',
    probe: {
      stageUuid: 'public',
      status: 'failed',
      error: 'The build timed out',
      allowances: [],
    },
  }
  expect(mintableRow(failed, 'public')).toBe(true)
  expect(blockedReason(failed, 'public')).toBeNull()

  // A successful build outranks a failed list read: the row becomes eligible and
  // the old read error leaves the log.
  const recovered: WalletRun = {
    ...row,
    status: 'failed',
    statusStage: 'public',
    checkFailed: true,
    error: 'The list read failed',
    caps: {},
    probe: { stageUuid: 'public', status: 'eligible', allowances: [] },
  }
  expect(stageStatusFor(recovered, 'public', false)).toBe('eligible')
  expect(mintableRow(recovered, 'public')).toBe(true)
  expect(reasonFor(recovered, 'public')).toBeNull()
  expect(blockedReason(recovered, 'public')).toBeNull()

  // A build that succeeds outranks a list that reported no remaining allowance.
  const capped: WalletRun = { ...recovered, checkFailed: false, caps: { public: 0 } }
  const applied = applyProbeVerdicts(
    [capped],
    'public',
    new Map([[capped.walletId, { status: 'eligible' as const }]])
  )[0]
  expect(applied?.caps.public).toBeNull()
  expect(mintableRow(applied as WalletRun, 'public')).toBe(true)

  // A wallet that has not granted the allowance is held out of the batch the same way
  // a block is, and Start refuses it before a run can sign.
  const needsApproval: WalletRun = {
    ...row,
    status: 'eligible',
    statusStage: 'public',
    probe: {
      stageUuid: 'public',
      status: 'needs-approval',
      error: 'The allowance is short by 20 Basecat.',
      allowances: [],
    },
  }
  expect(stageStatusFor(needsApproval, 'public', false)).toBe('needs-approval')
  expect(mintableRow(needsApproval, 'public')).toBe(false)
  expect(reasonFor(needsApproval, 'public')).toBe(
    needsApproval.probe?.error ?? null
  )
  const task = createTask()
  task.wallets = [needsApproval.walletId]
  task.stageUuid = 'public'
  task.checked = true
  expect(startRefusalFor(task, [needsApproval])).toContain('needs approval')
})

test('only a missing token ID refusal is a task block', () => {
  const refusal = (message: string, code = '422') =>
    new ScatterError(422, code, message)

  // A missing ID is the operator's fix. The provider's own wording is what the row
  // carries, so the classifier reads both the message and the code.
  expect(isMissingTokenIdRefusal(refusal('Token ID is required'))).toBe(true)
  expect(isMissingTokenIdRefusal(refusal('Missing token ID'))).toBe(true)
  expect(isMissingTokenIdRefusal(refusal('tokenId must be provided'))).toBe(true)
  expect(isMissingTokenIdRefusal(refusal('This list requires a token ID'))).toBe(
    true
  )
  expect(isMissingTokenIdRefusal(refusal('tokenId absent'))).toBe(true)
  expect(isMissingTokenIdRefusal(refusal('Token ID not found'))).toBe(true)
  expect(
    isMissingTokenIdRefusal(new ScatterError(422, 'MISSING_TOKEN_ID', 'refused'))
  ).toBe(true)

  // A token the wallet does not hold, or any other refusal, is not a task fix.
  expect(
    isMissingTokenIdRefusal(
      refusal('Token ID 42 is not held by this wallet')
    )
  ).toBe(false)
  expect(isMissingTokenIdRefusal(refusal('Scatter build failed'))).toBe(false)
})
