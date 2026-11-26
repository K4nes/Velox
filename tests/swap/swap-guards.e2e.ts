import { test } from '@e2e-dev/web'
import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { App, JsonValue, Screen } from 'e2e'
import { encodeFunctionData, keccak256 } from 'viem'
import { generatePrivateKey } from 'viem/accounts'

import {
  testRpc,
  mintWallets,
  walletFolder,
  walletRow,
} from '../support/data'
import { relayQuoteFixture } from '../support/fixtures/relay'
import { mockRpc, word } from '../support/rpc'
import { seedVelox } from '../support/seed'
import type { Seed } from '../support/seed'

const RPC_URL = 'http://127.0.0.1:8545'
const RPC_URL_PATTERN = /^http:\/\/127\.0\.0\.1:8545(?:\/.*)?$/
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const BALANCE = 10n ** 18n
const REPLACEMENT_HASH = `0x${'22'.repeat(32)}`

async function openSwap(app: App, browser: Browser, seed: Seed) {
  await app.open('/swap')
  await seedVelox(browser, seed)
  await app.open('/swap')
}

async function selectFolder(
  screen: Screen,
  browser: Browser,
  folderNames: string[]
) {
  await screen
    .getByRole('button', { name: /Select wallets \(\d+ selected\)/ })
    .click()
  for (const folderName of folderNames) {
    await screen
      .getByRole('checkbox', { name: `Select all in ${folderName}` })
      .click()
  }
  await browser.keyboard.press('Escape')
}

function replacementReceipt(from: string) {
  return {
    transactionHash: REPLACEMENT_HASH,
    transactionIndex: '0x0',
    blockHash: `0x${'00'.repeat(32)}`,
    blockNumber: '0x2',
    from,
    to: WETH,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    type: '0x2',
    effectiveGasPrice: '0x1',
  }
}

function replacementTransaction(from: string) {
  return {
    hash: REPLACEMENT_HASH,
    from,
    to: WETH,
    input: '0x1234',
    value: '0x0',
    nonce: '0x0',
    type: '0x2',
    chainId: '0x1',
    gas: '0x30d40',
    maxFeePerGas: '0x3b9aca00',
    maxPriorityFeePerGas: '0x3b9aca00',
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
    v: '0x0',
    r: `0x${'00'.repeat(32)}`,
    s: `0x${'00'.repeat(32)}`,
  }
}

test('two saved records of one address block the batch before any request', async ({
  app,
  browser,
  screen,
}) => {
  const rpc = await mockRpc(browser, {
    url: RPC_URL_PATTERN,
    chainId: '0x1',
    ethCall: { '0x70a08231': word(BALANCE) },
  })

  let quotes = 0
  await browser.route('**/api.relay.link/quote/v2', async (route) => {
    quotes += 1
    await route.fulfill({ status: 200, json: relayQuoteFixture() })
  })

  const privateKey = generatePrivateKey()
  const first = walletFolder('Duplicate A')
  const second = walletFolder('Duplicate B')
  const a = walletRow({ label: 'dup-a', privateKey, folderId: first.id })
  const b = walletRow({ label: 'dup-b', privateKey, folderId: second.id })

  await openSwap(app, browser, {
    folders: [first, second],
    wallets: [a, b],
    connections: [testRpc('ethereum', RPC_URL)],
  })

  await selectFolder(screen, browser, [first.name, second.name])
  await screen.getByLabel('Amount for dup-a').fill('0.1')
  await screen.getByLabel('Amount for dup-b').fill('0.1')

  const refusal = '2 saved wallets share an address; select one record per wallet'
  await expect(screen.getByText(refusal)).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Swap 2 wallets' })).toBeDisabled()

  // The preview debounce is 500 ms; a quote absent after it proves the
  // duplicate batch never reached the quote path.
  const delay = Promise.withResolvers<void>()
  setTimeout(delay.resolve, 700)
  await delay.promise
  expect(quotes, 'a duplicate batch must not be quoted').toBe(0)
  expect(rpc.count('eth_sendRawTransaction'), 'a duplicate batch must not send').toBe(0)
})

test('a repriced replacement is indexed and linked by its replacement hash', async ({
  app,
  browser,
  screen,
}) => {
  await mockRpc(browser, {
    url: RPC_URL_PATTERN,
    chainId: '0x1',
    ethCall: { '0x70a08231': word(BALANCE) },
    allowWrites: true,
  })

  const folder = walletFolder('Replacement')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  let originalHash: `0x${string}` | null = null
  let sends = 0
  await browser.route(RPC_URL_PATTERN, async (route) => {
    const body = JSON.parse(route.request.postData ?? '{}') as {
      id?: JsonValue
      method?: string
      params?: JsonValue[]
    }
    const reply = (result: JsonValue) =>
      route.fulfill({
        status: 200,
        json: { jsonrpc: '2.0', id: body.id ?? null, result },
      })

    if (body.method === 'eth_sendRawTransaction') {
      sends += 1
      const raw = body.params?.[0]
      if (typeof raw === 'string') {
        originalHash = keccak256(raw as `0x${string}`)
      }
      await reply(REPLACEMENT_HASH)
      return
    }

    const requested =
      typeof body.params?.[0] === 'string'
        ? body.params[0].toLowerCase()
        : null
    const original = originalHash?.toLowerCase() ?? null

    if (
      body.method === 'eth_getTransactionReceipt' &&
      original !== null &&
      requested === original
    ) {
      await reply(null)
      return
    }
    if (
      body.method === 'eth_getTransactionByHash' &&
      original !== null &&
      requested === original
    ) {
      await reply(null)
      return
    }
    if (body.method === 'eth_getTransactionReceipt' && requested === REPLACEMENT_HASH) {
      await reply(replacementReceipt(wallet.address))
      return
    }
    if (body.method === 'eth_getTransactionBySenderAndNonce') {
      await reply(replacementTransaction(wallet.address))
      return
    }

    await route.fallback()
  })

  await browser.route('**/api.relay.link/quote/v2', async (route) => {
    await route.fulfill({
      status: 200,
      json: relayQuoteFixture({
        requestId: 'e2e-replacement',
        operation: 'wrap',
        stepId: 'deposit',
        check: false,
        to: WETH,
        data: '0x1234',
      }),
    })
  })

  const indexer: { body: Record<string, JsonValue> | null } = { body: null }
  await browser.route('**/api.relay.link/transactions/**', async (route) => {
    indexer.body = JSON.parse(route.request.postData ?? '{}') as Record<
      string,
      JsonValue
    >
    await route.fulfill({ status: 200, json: {} })
  })

  await openSwap(app, browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [testRpc('ethereum', RPC_URL)],
  })

  await selectFolder(screen, browser, [folder.name])
  await screen.getByLabel(`Amount for ${wallet.label}`).fill('0.1')
  await expect(screen.getByText(/^≈ 0\.1 ETH$/)).toBeVisible()
  await screen.getByRole('button', { name: 'Swap 1 wallet' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.label })
  await expect(row).toContainText('Done')
  await expect(screen.getByRole('link', { name: /Tx Hash/ })).toHaveAttribute(
    'href',
    new RegExp(REPLACEMENT_HASH)
  )
  expect(indexer.body?.txHash, 'the indexer must receive the replacement hash').toBe(
    REPLACEMENT_HASH
  )
  expect(sends, 'the run sends the quote once').toBe(1)
})

test('the rail shows the minimum received, price impact and Relay fee', async ({
  app,
  browser,
  screen,
}) => {
  await mockRpc(browser, {
    url: RPC_URL_PATTERN,
    chainId: '0x1',
    ethCall: { '0x70a08231': word(BALANCE) },
  })

  await browser.route('**/api.relay.link/quote/v2', async (route) => {
    await route.fulfill({
      status: 200,
      json: relayQuoteFixture({
        operation: 'unwrap',
        minimumAmount: '98000000000000000',
        totalImpactPercent: '0.25',
        relayFee: { amount: '1000000000000000', symbol: 'ETH', decimals: 18 },
      }),
    })
  })

  const folder = walletFolder('Worst Case')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await openSwap(app, browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [testRpc('ethereum', RPC_URL)],
  })

  await selectFolder(screen, browser, [folder.name])
  await screen.getByLabel(`Amount for ${wallet.label}`).fill('0.1')

  await expect(browser.locator('dd')).toHaveText([
    'WETH → ETH',
    'Unwrap',
    '0.1 WETH',
    '≈ 0.1 ETH',
    '0.098 ETH',
    '0.25%',
    '0.001 ETH',
  ])
})

test('an approve step aimed at another token fails before any send', async ({
  app,
  browser,
  screen,
}) => {
  const rpc = await mockRpc(browser, {
    url: RPC_URL_PATTERN,
    chainId: '0x1',
    ethCall: { '0x70a08231': word(BALANCE) },
  })

  const approveData = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'approve',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      },
    ] as const,
    functionName: 'approve',
    args: [WETH, 1n],
  })

  await browser.route('**/api.relay.link/quote/v2', async (route) => {
    await route.fulfill({
      status: 200,
      json: relayQuoteFixture({
        requestId: 'e2e-wrong-approve-target',
        operation: 'unwrap',
        to: WETH,
        data: '0x1234',
        approve: { to: USDC, data: approveData },
      }),
    })
  })

  const folder = walletFolder('Wrong Approve')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await openSwap(app, browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [testRpc('ethereum', RPC_URL)],
  })

  await selectFolder(screen, browser, [folder.name])
  await screen.getByLabel(`Amount for ${wallet.label}`).fill('0.1')
  const start = screen.getByRole('button', { name: 'Swap 1 wallet' })
  await expect(start).toBeEnabled()
  await start.click()

  const row = screen.getByRole('row').filter({ hasText: wallet.label })
  await expect(row).toContainText('Approve step targets')
  expect(
    rpc.count('eth_sendRawTransaction'),
    'an unvalidated approve target must not be signed'
  ).toBe(0)
})
