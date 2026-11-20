import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import type { Browser, WebApp } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Screen } from 'e2e'
import { mintWallets, pinWalletChain, walletFolder } from '../support/data'
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
import type {
  MintEvent,
  ScatterMintAnswer,
  ScatterMintBody,
} from '../support/mint'
import type { FolderRow, WalletRow } from '../support/seed'
import {
  applyProbeVerdicts,
  blockedReason,
  createTask,
  mintableRow,
  reasonFor,
  stageStatusFor,
  startRefusalFor,
  taskView,
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

function recordedAllowance() {
  const allowance = recordedMintBuild.body.erc20s?.[0]
  if (allowance === undefined) {
    throw new Error('the recorded ERC-20 build has no allowance')
  }
  return allowance
}

// The module constant must be narrowed at the source: a top-level guard does not carry
// into the closures that read it.
const RECORDED_ALLOWANCE = recordedAllowance()
const RECORDED_TOKEN = RECORDED_ALLOWANCE.address
// The build's own display metadata: the only source for the token's symbol and decimals.
const RECORDED_LIST_PAYMENTS = recordedMintBuild.body.listPayments ?? []

// The recorded build's allowance as the probe carries it, for verdict tests.
const RECORDED_METADATA = RECORDED_LIST_PAYMENTS[0]
const recordedAllowanceModel = {
  token: RECORDED_TOKEN as `0x${string}`,
  amount: BigInt(RECORDED_ALLOWANCE.amount),
  spender: SCATTER_CONTRACT as `0x${string}`,
  ...(RECORDED_METADATA
    ? {
        symbol: RECORDED_METADATA.currencySymbol,
        decimals: RECORDED_METADATA.currencyDecimals,
      }
    : {}),
}

// The two `eth_call` selectors Check may read: ERC-20 balanceOf and allowance.
const allowanceReads = (calls: { selector: string }[]) =>
  calls.filter(
    (call) => call.selector === '0x70a08231' || call.selector === '0xdd62ed3e'
  )

/** The `approve(address,uint256)` selector a granted allowance carries. */
const APPROVE_SELECTOR = '0x095ea7b3'

type SendEvent = Extract<MintEvent, { kind: 'send' }>

/** Every transaction the mocked chain broadcast, in send order. */
const sendsOf = (events: MintEvent[]) =>
  events.filter((event): event is SendEvent => event.kind === 'send')

// The mock decodes a serialized transaction's target in lower case, so the token a test
// compares against is the same address in that case.
const RECORDED_TOKEN_ADDRESS = RECORDED_TOKEN.toLowerCase()
// The recorded build's base-unit amount, and a balance that covers it.
const RECORDED_AMOUNT = BigInt(RECORDED_ALLOWANCE.amount)
const COVERING_BALANCE = ((RECORDED_AMOUNT * 5n) / 4n).toString()

// A second real ERC-20, so a two-token build names a token the recorded build does not.
const SECOND_TOKEN_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

/** A wallet that holds the recorded token and has granted none of it. */
const shortAllowance = (owner: string, token = RECORDED_TOKEN) => ({
  token,
  owner,
  spender: SCATTER_CONTRACT,
  allowance: '0',
})

type TokenListOptions = {
  app: WebApp
  browser: Browser
  screen: Screen
  folder: FolderRow
  wallets: WalletRow[]
  /** The build's answer. The recorded allowance by default. */
  mint?: ScatterMintAnswer | ((body: ScatterMintBody) => ScatterMintAnswer)
  balances?: { token: string; owner: string; balance: string }[]
  allowances?: { token: string; owner: string; spender: string; allowance: string }[]
  /** Fails the receipt of a send to one of these targets, and leaves the rest alone. */
  revertTo?: string[]
  /** Holds a wallet's broadcast response open, so a stop can arrive mid-send. */
  sendDelayMs?: number
  /** Holds every build response open, so a stop can arrive mid-build. */
  mintDelayMs?: number
  /** Tokens whose balance and allowance reads answer an RPC error. */
  failCalls?: string[]
}

/**
 * Seeds one ERC-20-priced Scatter list and checks it. The build asks for the recorded
 * allowance and the wallet holds and has granted it, so a test starts from an `Eligible`
 * row and overrides only the part its subject turns on.
 */
async function seedTokenList(options: TokenListOptions) {
  const { app, browser, screen, folder, wallets } = options
  // The stage price states the token so the Cost panel reads in it; the build's own
  // listPayments is what names the symbol and decimals.
  const calls = await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [
      {
        id: 'public',
        name: 'Public',
        price: '20',
        currencySymbol: 'Basecat',
        currencyAddress: RECORDED_TOKEN,
        decimals: 18,
        walletLimit: 1,
      },
    ],
    mint: options.mint ?? {
      erc20s: [RECORDED_ALLOWANCE],
      listPayments: RECORDED_LIST_PAYMENTS,
    },
    mintDelayMs: options.mintDelayMs,
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: wallets.map((wallet) => ({
      address: wallet.address,
      sendDelayMs: options.sendDelayMs,
    })),
    revertTo: options.revertTo,
    failCalls: options.failCalls,
    tokenBalances:
      options.balances ??
      wallets.map((wallet) => ({
        token: RECORDED_TOKEN,
        owner: wallet.address,
        balance: COVERING_BALANCE,
      })),
    tokenAllowances:
      options.allowances ??
      wallets.map((wallet) => ({
        token: RECORDED_TOKEN,
        owner: wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: RECORDED_ALLOWANCE.amount,
      })),
  })

  await seedMintPage(app, browser, folder, wallets)
  await checkCollection(browser, screen, folder, `https://scatter.art/c/${SLUG}`)

  return { calls, rpc }
}

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

test('the chain pin stores the slug the caller names', async ({ app, browser }) => {
  // The live ERC-20 lane signs on the collection's chain, and the app reads its chain
  // from storage before the first render, so the pin has to carry the slug it is given.
  await pinWalletChain(browser, 'base')
  await app.open('/mint/tasks')
  expect(
    await browser.evaluate(() => window.localStorage.getItem('wallet-chain'))
  ).toBe('base')
})

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

test('a build allowance answer marks that row Needs approval and logs what it needs, before any wallet signs', async ({
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
  // The approval is the run's job, so the verdict alone no longer refuses the start.
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
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

test('a covering allowance sends only the mint', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Covered')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The run re-read the allowance, found it covers the amount, and signed the mint alone.
  const sends = sendsOf(rpc.events)
  expect(sends.map((event) => event.to)).toEqual([SCATTER_CONTRACT])

  const mint = sends[0]
  if (mint === undefined) throw new Error('the run sent no mint')
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(`Mint ${mint.txHash}.`)
  await expect(log).not.toContainText('Approval 0x')
})

test('a stale allowance is re-read at run time before the mint is sent', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Stale Allowance')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // Check read a covering allowance. The wallet then spends it on another list, so a
  // run that trusted the check would sign the mint alone and revert on chain.
  rpc.setAllowance({
    token: RECORDED_TOKEN,
    owner: wallet.address,
    spender: SCATTER_CONTRACT,
    allowance: '0',
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  const sends = sendsOf(rpc.events)
  expect(sends.map((event) => event.to)).toEqual([
    RECORDED_TOKEN_ADDRESS,
    SCATTER_CONTRACT,
  ])

  const approval = sends[0]
  const mint = sends[1]
  if (approval === undefined || mint === undefined) {
    throw new Error('the run did not send the approval and the mint')
  }
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(`Approval ${approval.txHash}`)
  await expect(log).toContainText(`Mint ${mint.txHash}.`)
})

test('a pinned gas limit applies to the approval and the mint', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Approval Gas')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The same fee fields a native mint reads, including the pinned limit.
  await screen.getByRole('button', { name: 'Advanced Gas' }).click()
  await screen.getByLabel('Gas Limit').fill('300000')
  await screen.getByLabel('Max Fee (Gwei)').fill('1')
  await screen.getByLabel('Priority Fee (Gwei)').fill('0.1')
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // Both transactions are signed with the operator's limit, not an estimate.
  const sends = sendsOf(rpc.events)
  expect(sends.map((event) => event.gas)).toEqual(['300000', '300000'])
})

test('a short allowance approves the exact amount and then mints', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Granted')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The approval goes first, to the token, and the mint behind it to the collection.
  const sends = sendsOf(rpc.events)
  expect(
    sends.map((event) => `${event.to} ${event.data.slice(0, 10)}`)
  ).toEqual([
    `${RECORDED_TOKEN_ADDRESS} ${APPROVE_SELECTOR}`,
    `${SCATTER_CONTRACT} 0x4a21a2df`,
  ])

  const approval = sends[0]
  if (approval === undefined) throw new Error('the run sent no approval')
  // The approval names the collection as spender and the build's exact base-unit amount.
  expect([
    `0x${approval.data.slice(34, 74)}`,
    BigInt(`0x${approval.data.slice(74, 138)}`),
  ]).toEqual([SCATTER_CONTRACT, RECORDED_AMOUNT])

  const mint = sends[1]
  if (mint === undefined) throw new Error('the run sent no mint')
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(`Approval ${approval.txHash}`)
  await expect(log).toContainText(`Mint ${mint.txHash}.`)
})

test('a run-time short balance fails the row before any transaction', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Run Shortfall')
  const wallet = oneWallet(folder)
  const balance = (RECORDED_AMOUNT / 4n).toString()
  // Check reads a small request against the same balance and passes, so the row starts.
  // The run reads the build's real amount and stops before it signs anything.
  let builds = 0
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    mint: () => {
      builds += 1
      return {
        erc20s: [
          builds === 1
            ? { address: RECORDED_TOKEN, amount: balance }
            : RECORDED_ALLOWANCE,
        ],
        listPayments: RECORDED_LIST_PAYMENTS,
      }
    },
    balances: [{ token: RECORDED_TOKEN, owner: wallet.address, balance }],
    allowances: [shortAllowance(wallet.address)],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The run's own balance read is what stopped it, and it stopped before signing.
  expect(sendsOf(rpc.events)).toHaveLength(0)
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('Balance check failed')
  await expect(log).toContainText('15 Basecat')
})

test('a short balance on the second token fails before any approval is sent', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Two Token Shortfall')
  const wallet = oneWallet(folder)
  const secondAmount = (RECORDED_AMOUNT / 4n).toString()
  // Check sees only the first token, so the row starts. The run's own build asks for
  // both, and the second token's balance is the one that fails.
  let builds = 0
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    mint: () => {
      builds += 1
      return builds === 1
        ? {
            erc20s: [RECORDED_ALLOWANCE],
            listPayments: RECORDED_LIST_PAYMENTS,
          }
        : {
            erc20s: [
              RECORDED_ALLOWANCE,
              { address: SECOND_TOKEN_ADDRESS, amount: secondAmount },
            ],
            listPayments: RECORDED_LIST_PAYMENTS,
          }
    },
    balances: [
      { token: RECORDED_TOKEN, owner: wallet.address, balance: COVERING_BALANCE },
      { token: SECOND_TOKEN_ADDRESS, owner: wallet.address, balance: '0' },
    ],
    allowances: [
      shortAllowance(wallet.address),
      shortAllowance(wallet.address, SECOND_TOKEN_ADDRESS),
    ],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // Every balance is read first, so the second token's shortfall costs no gas and the
  // first token is never approved for a mint that cannot run.
  expect(sendsOf(rpc.events)).toHaveLength(0)
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('Balance check failed')
  await expect(log).toContainText('base units of')
})

test('a failed allowance read fails the row before any transaction', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Read Failure')
  const wallet = oneWallet(folder)
  const secondAmount = (RECORDED_AMOUNT / 4n).toString()
  // Check sees the first token, so the row starts. The run's build asks for both, and
  // the second token's read answers an RPC error.
  let builds = 0
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    mint: () => {
      builds += 1
      return builds === 1
        ? {
            erc20s: [RECORDED_ALLOWANCE],
            listPayments: RECORDED_LIST_PAYMENTS,
          }
        : {
            erc20s: [
              RECORDED_ALLOWANCE,
              { address: SECOND_TOKEN_ADDRESS, amount: secondAmount },
            ],
            listPayments: RECORDED_LIST_PAYMENTS,
          }
    },
    failCalls: [SECOND_TOKEN_ADDRESS],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // A read the run cannot complete stops the wallet before it signs anything.
  expect(sendsOf(rpc.events)).toHaveLength(0)
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('Balance check failed')
  await expect(log).toContainText('execution reverted')
})

test('a reverted approval stops the mint', async ({ app, browser, screen }) => {
  const folder = walletFolder('Scatter Approval Revert')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
    revertTo: [RECORDED_TOKEN],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The approval was the only send: the mint behind it was never signed.
  const sends = sendsOf(rpc.events)
  expect(sends.map((event) => event.to)).toEqual([RECORDED_TOKEN_ADDRESS])

  const approval = sends[0]
  if (approval === undefined) throw new Error('the run sent no approval')
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(`Approval ${approval.txHash}`)
  await expect(log).toContainText('Approval failed')
})

test('a mint revert after an approval keeps both hashes', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Mint Revert')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
    revertTo: [SCATTER_CONTRACT],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The approval landed and the mint after it reverted, so both hashes stay.
  const sends = sendsOf(rpc.events)
  expect(sends.map((event) => event.to)).toEqual([
    RECORDED_TOKEN_ADDRESS,
    SCATTER_CONTRACT,
  ])

  const [approval, mint] = sends
  if (approval === undefined || mint === undefined) {
    throw new Error('the run did not send the approval and the mint')
  }
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(`Approval ${approval.txHash}`)
  await expect(log).toContainText(`Mint ${mint.txHash}.`)
  await expect(log).toContainText('Mint failed: the transaction reverted.')
})

test('a re-check keeps the approval hash of the failed run', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Record Kept')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
    revertTo: [RECORDED_TOKEN],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const approval = sendsOf(rpc.events)[0]
  if (approval === undefined) throw new Error('the run sent no approval')

  // The next Check re-reads the wallet and restores the Needs approval verdict. The
  // approval already on chain stays in the log, so its hash is not lost.
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(`Approval ${approval.txHash}`)
})

test('two allowance entries approve in sequence, then the mint', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Two Tokens')
  const wallet = oneWallet(folder)
  const secondToken = SECOND_TOKEN_ADDRESS
  const secondAmount = (RECORDED_AMOUNT / 4n).toString()
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    mint: {
      erc20s: [
        RECORDED_ALLOWANCE,
        { address: secondToken, amount: secondAmount },
      ],
      listPayments: RECORDED_LIST_PAYMENTS,
    },
    balances: [
      { token: RECORDED_TOKEN, owner: wallet.address, balance: COVERING_BALANCE },
      { token: secondToken, owner: wallet.address, balance: secondAmount },
    ],
    allowances: [
      shortAllowance(wallet.address),
      shortAllowance(wallet.address, secondToken),
    ],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // Each allowance is granted before the next, and the mint spends both last.
  expect(sendsOf(rpc.events).map((event) => event.to)).toEqual([
    RECORDED_TOKEN_ADDRESS,
    secondToken.toLowerCase(),
    SCATTER_CONTRACT,
  ])
})

test('an abort after the approval is broadcast logs it and sends no mint', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Approval Stop')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
    sendDelayMs: 1_500,
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Approving', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  // Stop only once the approval reached the node: a stop before the broadcast sends
  // nothing and exercises a different branch.
  await expect
    .poll(() => sendsOf(rpc.events).length, { timeout: 30_000 })
    .toBe(1)

  await screen.getByRole('button', { name: 'Stop' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  const sends = sendsOf(rpc.events)
  expect(sends.map((event) => event.to)).toEqual([RECORDED_TOKEN_ADDRESS])

  const approval = sends[0]
  if (approval === undefined) throw new Error('the run sent no approval')
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText(`Approval ${approval.txHash}`)
  await expect(log).toContainText('Mint not sent')
})

test('a stop before anything is sent fails the row and leaves no run status', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Stop Before Send')
  const wallet = oneWallet(folder)
  // The run's build is held, so the stop lands before any transaction can be signed.
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
    mintDelayMs: 3_000,
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  // The row marks the run before the held build resolves, so the stop lands mid-build
  // rather than before the run reached the batch.
  await expect(row.getByText('Minting', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
  await screen.getByRole('button', { name: 'Stop' }).click()

  // The row records why the run ended instead of staying Minting forever.
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('stopped before anything was sent')
  await browser.keyboard.press('Escape')
  expect(sendsOf(rpc.events)).toHaveLength(0)
})

test('a Needs approval row starts and reaches Confirmed', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Approval Start')
  const wallet = oneWallet(folder)
  const { rpc } = await seedTokenList({
    app,
    browser,
    screen,
    folder,
    wallets: [wallet],
    allowances: [shortAllowance(wallet.address)],
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The approval is the run's job, so the verdict no longer refuses the start.
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  expect(sendsOf(rpc.events)).toHaveLength(2)
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

  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The run pays the native price and grants nothing, so it reads neither value and
  // sends nothing to the token an ERC-20 build would name.
  expect(allowanceReads(rpc.calls)).toHaveLength(0)
  expect(
    sendsOf(rpc.events).filter((event) => event.to === RECORDED_TOKEN_ADDRESS)
  ).toHaveLength(0)
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

test('a quantity above the checked quantity disables Start until Check runs again', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Quantity Verdict')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
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
        walletLimit: SCATTER_NO_LIMIT,
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
      { token: RECORDED_TOKEN, owner: wallet.address, balance: '50000000000000000000' },
    ],
    tokenAllowances: [
      {
        token: RECORDED_TOKEN,
        owner: wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: '40000000000000000000',
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
  const start = screen.getByRole('button', { name: 'Start Mint' })
  await expect(start).toBeEnabled()

  // The check priced quantity 1, so a larger task quantity is no longer covered.
  await screen.getByLabel('Quantity', { exact: true }).fill('3')
  await expect(start).toBeDisabled()
  await expect(start).toHaveAttribute('title', /Check again/)
  await expect(screen.getByText('60 Basecat', { exact: true })).toBeVisible()

  // Check again prices the new quantity and finds the balance short.
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Blocked', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('short by 10 Basecat')
  await browser.keyboard.press('Escape')

  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
})

test('a failed allowance read marks the row Failed and refuses Start', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Allowance Read Failure')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
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
    callError: 'execution reverted',
  })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('execution reverted')
  await browser.keyboard.press('Escape')

  // The token position is unknown, so neither Start nor arming may proceed.
  const start = screen.getByRole('button', { name: 'Start Mint' })
  await expect(start).toBeDisabled()
  await expect(start).toHaveAttribute('title', /could not be checked/)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
})

test('a token with no build metadata reads its symbol and decimals on chain', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter On-Chain Metadata')
  const wallet = oneWallet(folder)
  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: SCATTER_CHAIN_ID,
    lists: [
      { id: 'public', name: 'Public', price: '0.01', walletLimit: 1 },
    ],
    mint: { erc20s: [RECORDED_ALLOWANCE] },
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    tokenMetadata: [
      { token: RECORDED_TOKEN, symbol: 'Basecat', decimals: 18 },
    ],
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
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const log = await openExecutionLog(screen, wallet.address)
  await expect(log).toContainText('symbol Basecat, decimals 18')
  await browser.keyboard.press('Escape')

  // Without build metadata the panel still prices the token, not the stage's ETH. The
  // unit price and the total for one mintable wallet both read in the token.
  await expect(screen.getByText('20 Basecat', { exact: true })).toHaveCount(2)
  expect(
    rpc.calls.filter((call) => call.selector === '0x95d89b41')
  ).toHaveLength(1)
  expect(
    rpc.calls.filter((call) => call.selector === '0x313ce567')
  ).toHaveLength(1)
  expect(rpc.events.filter((event) => event.kind === 'send')).toHaveLength(0)
})

test('a Needs approval row keeps arming enabled on an open list the provider did not mark active', async ({
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
  // so the same button arms instead of starting. The run grants the allowance, so the
  // verdict does not take the arm away.
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Second' }).click()
  await expect(row.getByText('Needs approval', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
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
  // A failed build refuses the batch and the start until a new Check answers it.
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
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
    // The picker change is asserted against the probe hold, so the hold has to outlast
    // the assertion that reads it.
    mintDelayMs: 1_500,
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
  // The verdict landed, and the run grants the allowance, so Start opens again.
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()

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

  // A failed build refuses the batch until a new Check answers it, so it is neither
  // mintable nor a startable task.
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
  expect(mintableRow(failed, 'public')).toBe(false)
  expect(blockedReason(failed, 'public')).toBeNull()
  const failedTask = createTask()
  failedTask.wallets = [failed.walletId]
  failedTask.stageUuid = 'public'
  failedTask.checked = true
  expect(startRefusalFor(failedTask, [failed])).toContain('failed')

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

  // A wallet that has not granted the allowance stays in the batch: the run grants it
  // before it signs, so Start takes the row.
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
  expect(mintableRow(needsApproval, 'public')).toBe(true)
  expect(reasonFor(needsApproval, 'public')).toBe(
    needsApproval.probe?.error ?? null
  )
  const task = createTask()
  task.wallets = [needsApproval.walletId]
  task.stageUuid = 'public'
  task.checked = true
  expect(startRefusalFor(task, [needsApproval])).toBeNull()
})

test('an allowance verdict covers the quantity it priced', () => {
  const row: WalletRun = {
    walletId: 'wallet-1',
    label: 'Wallet 1',
    address: '0x0000000000000000000000000000000000000001',
    caps: { public: null },
    status: 'eligible',
    statusStage: 'public',
    mintedStages: [],
    probe: null,
  }
  const task = createTask()
  task.wallets = [row.walletId]
  task.stageUuid = 'public'
  task.checked = true

  // An allowance read that failed leaves the token position unknown, so the row is
  // not mintable and Start explains that Check must run again.
  const failedRow: WalletRun = {
    ...row,
    probe: {
      stageUuid: 'public',
      status: 'failed',
      error: 'execution reverted',
      allowances: [recordedAllowanceModel],
      quantity: 1,
    },
  }
  expect(mintableRow(failedRow, 'public')).toBe(false)
  expect(startRefusalFor(task, [failedRow])).toContain('could not be checked')

  // A verdict priced at quantity 1 does not cover a task raised to 2.
  const eligibleRow: WalletRun = {
    ...row,
    probe: {
      stageUuid: 'public',
      status: 'eligible',
      allowances: [recordedAllowanceModel],
      quantity: 1,
    },
  }
  task.quantity = '1'
  expect(startRefusalFor(task, [eligibleRow])).toBeNull()
  task.quantity = '2'
  expect(startRefusalFor(task, [eligibleRow])).toContain('smaller quantity')

  // A multi-token allowance keeps every unit and prices each against the quantity.
  const multiRow: WalletRun = {
    ...row,
    probe: {
      stageUuid: 'public',
      status: 'eligible',
      allowances: [recordedAllowanceModel, recordedAllowanceModel],
      quantity: 2,
    },
  }
  const view = taskView({
    task,
    rows: [multiRow],
    runningIds: [],
    knownWalletIds: new Set([row.walletId]),
    locked: false,
    nowMs: Date.now(),
    blockSample: null,
  })
  expect(view.allowanceUnits).toHaveLength(2)
  expect(view.allowanceTotals).toEqual([
    40_000000000000000000n,
    40_000000000000000000n,
  ])
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
