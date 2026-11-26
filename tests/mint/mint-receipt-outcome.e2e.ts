import { test } from '@e2e-dev/web'
import type { Browser, WebApp } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { JsonValue, Screen } from 'e2e'
import { keccak256 } from 'viem'
import type { TransactionSerialized } from 'viem'
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
import type { MintEvent } from '../support/mint'
import type { FolderRow, WalletRow } from '../support/seed'

const SLUG = 'receipt-outcome-drop'
const CHAIN_ID = 4663
const MINT_DATA = '0x4a21a2df'
const REPLACEMENT_HASH = `0x${'cd'.repeat(32)}`

type ReplacementMode = 'repriced' | 'cancelled'

type RpcRequest = {
  id?: JsonValue
  method?: string
  params?: unknown[]
}

const sendsOf = (events: MintEvent[]) =>
  events.filter((event) => event.kind === 'send')

async function openNativeTask(options: {
  app: WebApp
  browser: Browser
  screen: Screen
  folder: FolderRow
  wallet: WalletRow
  revert?: boolean
}): Promise<MintEvent[]> {
  await mockScatterNetwork({
    browser: options.browser,
    slug: SLUG,
    chainId: CHAIN_ID,
    lists: [{ id: 'public', name: 'Public', walletLimit: 1 }],
    mint: {},
  })
  const rpc = await mockMintRpc({
    browser: options.browser,
    wallets: [options.wallet],
    revert: options.revert,
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
  await expect(
    options.screen
      .getByRole('row')
      .filter({ hasText: options.wallet.address })
      .getByText('Eligible', { exact: true })
  ).toBeVisible({ timeout: 60_000 })
  return rpc.events
}

/**
 * Answers the nonce slot as a replacement for the mint the app sent, so the
 * receipt wait has to tell a repriced replacement from a cancelled one.
 */
async function mockReplacement(options: {
  browser: Browser
  wallet: WalletRow
  mode: ReplacementMode
}): Promise<void> {
  const originals = new Set<string>()
  const to =
    options.mode === 'cancelled'
      ? options.wallet.address
      : SCATTER_CONTRACT
  const input = options.mode === 'cancelled' ? '0x' : MINT_DATA
  const transaction = {
    hash: REPLACEMENT_HASH,
    blockHash: `0x${'bb'.repeat(32)}`,
    blockNumber: '0x1',
    transactionIndex: '0x0',
    from: options.wallet.address,
    to,
    value: '0x0',
    input,
    nonce: '0x0',
    gas: '0x30d40',
    gasPrice: '0x3b9aca00',
    maxFeePerGas: '0x77359400',
    maxPriorityFeePerGas: '0x3b9aca00',
    type: '0x2',
    chainId: '0x1237',
  }
  const receipt = {
    transactionHash: REPLACEMENT_HASH,
    transactionIndex: '0x0',
    blockHash: `0x${'bb'.repeat(32)}`,
    blockNumber: '0x1',
    from: options.wallet.address,
    to,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    type: '0x2',
    effectiveGasPrice: '0x1',
  }

  await options.browser.route(/rpc\.velox\.test/, async (route) => {
    const request = JSON.parse(route.request.postData ?? '{}') as RpcRequest
    const answer = (result: JsonValue) =>
      route.fulfill({
        status: 200,
        json: { jsonrpc: '2.0', id: request.id ?? null, result },
      })
    const hash = String(request.params?.[0] ?? '').toLowerCase()

    switch (request.method) {
      case 'eth_sendRawTransaction': {
        const serialized = request.params?.[0] as TransactionSerialized
        originals.add(keccak256(serialized).toLowerCase())
        await route.fallback()
        return
      }
      case 'eth_blockNumber':
        await answer('0x2')
        return
      case 'eth_getTransactionBySenderAndNonce':
        await answer(transaction)
        return
      case 'eth_getTransactionByHash':
        if (originals.has(hash)) {
          await answer(null)
          return
        }
        await route.fallback()
        return
      case 'eth_getTransactionReceipt':
        if (hash === REPLACEMENT_HASH) {
          await answer(receipt)
          return
        }
        if (originals.has(hash)) {
          await answer(null)
          return
        }
        await route.fallback()
        return
      default:
        await route.fallback()
    }
  })
}

test('a reverted mint is retried after Check without a permanent retirement', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Revert Retry')
  const wallet = oneWallet(folder)
  const rpc = await openNativeTask({
    app,
    browser,
    screen,
    folder,
    wallet,
    revert: true,
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // A reverted broadcast is not a landing. The stage must be mintable again.
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect
    .poll(() => sendsOf(rpc).length, { timeout: 30_000 })
    .toBe(2)
})

test('a repriced replacement confirms the mint with its own hash', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Repriced')
  const wallet = oneWallet(folder)
  const rpc = await openNativeTask({ app, browser, screen, folder, wallet })
  await mockReplacement({ browser, wallet, mode: 'repriced' })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  expect(sendsOf(rpc)).toHaveLength(1)

  // The row's hash is the replacement's, because that is the transaction that
  // mined and carried this mint.
  await screen
    .getByRole('button', { name: `Show execution log for ${wallet.address}` })
    .click()
  const log = screen.getByRole('dialog')
  await expect(log).toContainText(`Mint repriced to ${REPLACEMENT_HASH}.`)
})

test('a cancelled replacement fails the row and releases the stage', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Cancelled Replacement')
  const wallet = oneWallet(folder)
  await openNativeTask({ app, browser, screen, folder, wallet })
  await mockReplacement({ browser, wallet, mode: 'cancelled' })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(row.getByText('Failed', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // The cancel filled the nonce slot without minting, so the stage is free again.
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeEnabled()
})
