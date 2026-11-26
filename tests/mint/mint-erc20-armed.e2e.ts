import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Browser, WebApp } from '@e2e-dev/web'
import type { Screen } from 'e2e'
import { walletFolder } from '../support/data'
import {
  SCATTER_CONTRACT,
  checkCollection,
  mockMintRpc,
  mockScatterNetwork,
  oneWallet,
  pinMintGas,
  seedMintPage,
} from '../support/mint'
import type { MintCall, MintEvent } from '../support/mint'
import type { FolderRow, WalletRow } from '../support/seed'

const SLUG = 'scatter-erc20-armed'
const CHAIN_ID = 4663
const TOKEN = '0xb2000000000000000000004c27f6523082f41d01'
const UNIT_AMOUNT = '1000'
const LIST_PAYMENTS = [
  {
    currencyAddress: TOKEN,
    currencySymbol: 'TKN',
    currencyDecimals: 0,
    unitPaymentValue: UNIT_AMOUNT,
  },
]

type TestList = {
  id: string
  name: string
  price: string
  currencySymbol: string
  currencyAddress: string
  decimals: number
  walletLimit: number
  startTime: string
}

const sendsOf = (events: MintEvent[]) =>
  events.filter((event) => event.kind === 'send')

const tokenList = (options: { startTime: string; walletLimit: number }): TestList => ({
  id: 'token-list',
  name: 'Token List',
  price: UNIT_AMOUNT,
  currencySymbol: 'TKN',
  currencyAddress: TOKEN,
  decimals: 0,
  walletLimit: options.walletLimit,
  startTime: options.startTime,
})

async function seedTokenTask(options: {
  app: WebApp
  browser: Browser
  screen: Screen
  folder: FolderRow
  wallet: WalletRow
  list: TestList
  allowance: string
}): Promise<{ events: MintEvent[]; calls: MintCall[] }> {
  await mockScatterNetwork({
    browser: options.browser,
    slug: SLUG,
    chainId: CHAIN_ID,
    lists: [options.list],
    mint: {
      erc20s: [{ address: TOKEN, amount: UNIT_AMOUNT }],
      listPayments: LIST_PAYMENTS,
    },
  })
  const rpc = await mockMintRpc({
    browser: options.browser,
    wallets: [options.wallet],
    // The armed case fires on chain time, which has to advance with the clock.
    blockTime: () => Date.now(),
    tokenBalances: [
      {
        token: TOKEN,
        owner: options.wallet.address,
        balance: '10000',
      },
    ],
    tokenAllowances: [
      {
        token: TOKEN,
        owner: options.wallet.address,
        spender: SCATTER_CONTRACT,
        allowance: options.allowance,
      },
    ],
  })
  await seedMintPage(options.app, options.browser, options.folder, [
    options.wallet,
  ])
  await checkCollection(
    options.browser,
    options.screen,
    options.folder,
    `https://scatter.art/c/${SLUG}`
  )
  return rpc
}

test('an armed token-priced list approves and mints without simulating the mint', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter ERC-20 Armed')
  const wallet = oneWallet(folder)
  const startTime = new Date(Date.now() + 8_000).toISOString()
  const rpc = await seedTokenTask({
    app,
    browser,
    screen,
    folder,
    wallet,
    list: tokenList({ startTime, walletLimit: 1 }),
    allowance: '0',
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Token List' }).click()
  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(screen.getByText('Mint opens in')).toBeVisible({
    timeout: 10_000,
  })

  await expect
    .poll(() => sendsOf(rpc.events).length, { timeout: 60_000 })
    .toBe(2)

  const sends = sendsOf(rpc.events)
  // The approval is the first transaction, and the mint is the only one after it.
  expect(sends[0]?.to).toBe(TOKEN)
  expect(sends[0]?.data.startsWith('0x095ea7b3')).toBe(true)
  expect(sends[1]?.to).toBe(SCATTER_CONTRACT)
  // Readiness did not spend an `eth_call` on a mint that cannot succeed before
  // the approval: the chain-time window is the gate.
  expect(
    rpc.calls.filter((call) => call.to === SCATTER_CONTRACT)
  ).toHaveLength(0)
})

test('a token-priced check keeps the probed quantity instead of the cap', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter ERC-20 Prefill')
  const wallet = oneWallet(folder)
  await seedTokenTask({
    app,
    browser,
    screen,
    folder,
    wallet,
    list: tokenList({
      startTime: new Date(Date.now() - 60_000).toISOString(),
      walletLimit: 3,
    }),
    allowance: UNIT_AMOUNT,
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByLabel('Quantity')).toHaveValue('1')
})

test('a token-priced row keeps Start enabled at the quantity Check priced', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter ERC-20 Start')
  const wallet = oneWallet(folder)
  await seedTokenTask({
    app,
    browser,
    screen,
    folder,
    wallet,
    list: tokenList({
      startTime: new Date(Date.now() - 60_000).toISOString(),
      walletLimit: 3,
    }),
    allowance: UNIT_AMOUNT,
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
})

test('raising a token-priced quantity disables Start until Check reprices it', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter ERC-20 Recheck')
  const wallet = oneWallet(folder)
  await seedTokenTask({
    app,
    browser,
    screen,
    folder,
    wallet,
    list: tokenList({
      startTime: new Date(Date.now() - 60_000).toISOString(),
      walletLimit: 3,
    }),
    allowance: '2000',
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const start = screen.getByRole('button', { name: 'Start Mint' })
  await screen.getByLabel('Quantity').fill('2')
  await expect(start).toBeDisabled()

  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(start).toBeEnabled()
})
