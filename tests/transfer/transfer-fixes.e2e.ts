import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import {
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  parseTransaction,
  toFunctionSelector,
} from 'viem'
import type { TransactionSerialized } from 'viem'
import type { Browser } from '@e2e-dev/web'
import type { FolderRow, WalletRow } from '../support/seed'
import {
  mintWallets,
  openseaConnection,
  robinhoodRpc,
  walletFolder,
} from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture, holdingsSpread } from '../support/fixtures/holdings'
import { mockCollection, mockHoldings } from '../support/opensea'
import { mockRpc, word } from '../support/rpc'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const RPC_URL = 'http://127.0.0.1:8545'
const DESTINATION = '0x0000000000000000000000000000000000000001'
const SUPPORTS_INTERFACE = toFunctionSelector('supportsInterface(bytes4)')
const OWNER_OF = toFunctionSelector('ownerOf(uint256)')
const BALANCE_OF = toFunctionSelector('balanceOf(address,uint256)')
const ERC1155_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'safeTransferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

async function seedTransfer(
  app: { open(path: string): Promise<void> },
  browser: Browser,
  folder: FolderRow,
  wallet: WalletRow
) {
  await app.open('/transfer')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [robinhoodRpc(RPC_URL), openseaConnection('deterministic-key')],
  })
  await app.open('/transfer')
}

test('an ERC-1155 transfer carries the chosen unit count', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Transfer Units')
  const [wallet] = mintWallets(1, folder.id)
  if (!wallet) throw new Error('mintWallets(1) returned no wallet')

  await mockCollection(browser, {
    slug: 'mock-transfer-units',
    body: collectionFixture({
      slug: 'mock-transfer-units',
      name: 'Mock Transfer Units',
      contract: '0x00000000000000000000000000000000000000bb',
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([
      {
        contract: '0x00000000000000000000000000000000000000bb',
        identifier: '1',
        quantity: 5,
      },
    ]),
  })
  // No ERC-165 answer and no ownerOf answer: the probe falls through to
  // balanceOf, which is the ERC-1155 path.
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    allowWrites: true,
    ethCall: {
      [SUPPORTS_INTERFACE]: '0x',
      [OWNER_OF]: '0x',
      [BALANCE_OF]: word(5),
    },
  })

  await seedTransfer(app, browser, folder, wallet)
  await scanCollection({
    browser,
    screen,
    feature: 'transfer',
    collection: 'mock-transfer-units',
    folder: folder.name,
  })

  const token = screen.getByRole('checkbox', { name: 'Select token #1' })
  await expect(token).toBeEnabled()
  await token.check()
  await screen
    .getByLabel('Units to transfer for token #1')
    .fill('3')

  await screen.getByLabel('Or paste an address').fill(DESTINATION)
  await screen.getByLabel('Or paste an address').press('Tab')

  const button = screen.getByRole('button', { name: 'Transfer 3 units' })
  await expect(button).toBeEnabled()
  await button.click()

  await expect
    .poll(() => rpc.count('eth_sendRawTransaction'))
    .toBe(1)
  const broadcast = rpc.calls.find(
    (call) => call.method === 'eth_sendRawTransaction'
  )
  const transaction = parseTransaction(
    String(broadcast?.params[0]) as TransactionSerialized
  )
  const decoded = decodeFunctionData({
    abi: ERC1155_TRANSFER_ABI,
    data: transaction.data ?? '0x',
  })
  expect(decoded.args[3]).toBe(3n)

  await expect(
    screen.getByRole('row').filter({ hasText: '3 units' })
  ).toBeVisible()
})

test('an unknown chain reports the chain, not an unreadable token', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Transfer Unknown Chain')
  const [wallet] = mintWallets(1, folder.id)
  if (!wallet) throw new Error('mintWallets(1) returned no wallet')

  await mockCollection(browser, {
    slug: 'mock-transfer-unknown',
    body: collectionFixture({
      slug: 'mock-transfer-unknown',
      name: 'Mock Unknown Chain',
      chain: 'mystery',
      contract: '0x00000000000000000000000000000000000000cc',
    }),
  })
  await mockHoldings(browser, {
    chain: 'mystery',
    address: wallet.address,
    body: holdingsSpread('0x00000000000000000000000000000000000000cc', 1),
  })
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    ethCall: { [SUPPORTS_INTERFACE]: word(1) },
  })

  await seedTransfer(app, browser, folder, wallet)
  await scanCollection({
    browser,
    screen,
    feature: 'transfer',
    collection: 'mock-transfer-unknown',
    folder: folder.name,
  })

  await expect(
    screen.getByText('Chain not supported: mystery')
  ).toBeVisible()
  await expect(
    screen.getByText('Could not check this token')
  ).toHaveCount(0)
  expect(rpc.count('eth_call')).toBe(0)
})

test('an ENS destination shows the name and the resolved address', async ({
  app,
  browser,
  screen,
}) => {
  const ensAddress = getAddress('0x1234567890123456789012345678901234567890')
  const resolved = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'address' }],
    [
      encodeAbiParameters([{ type: 'address' }], [ensAddress]),
      getAddress('0x0000000000000000000000000000000000000002'),
    ]
  )
  await mockRpc(browser, {
    url: /^https:\/\/ethereum-rpc\.publicnode\.com\/?$/,
    chainId: '0x1',
    ethCall: {
      [toFunctionSelector('resolveWithGateways(bytes,bytes,string[])')]:
        resolved,
    },
  })

  await app.open('/transfer')

  await screen.getByLabel('Or paste an address').fill('alice.eth')
  await expect(
    screen.getByText('Sends to alice.eth (0x1234…7890)')
  ).toBeVisible()
})

test('a repeating holdings cursor stops the scan and warns', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Transfer Repeating Cursor')
  const [wallet] = mintWallets(1, folder.id)
  if (!wallet) throw new Error('mintWallets(1) returned no wallet')

  const contract = '0x00000000000000000000000000000000000000dd'
  await mockCollection(browser, {
    slug: 'mock-transfer-repeat',
    body: collectionFixture({
      slug: 'mock-transfer-repeat',
      name: 'Mock Repeat',
      contract,
    }),
  })
  const holdings = await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([{ contract, identifier: '1' }], {
      next: 'same-cursor',
    }),
  })
  await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    ethCall: { [SUPPORTS_INTERFACE]: word(1) },
  })

  await seedTransfer(app, browser, folder, wallet)
  await scanCollection({
    browser,
    screen,
    feature: 'transfer',
    collection: 'mock-transfer-repeat',
    folder: folder.name,
  })

  await expect(
    screen.getByText('Scan stopped early; some tokens may be missing.')
  ).toBeVisible()
  expect(holdings.count).toBe(2)
})

test('a rescan keeps a spent token blocked', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Transfer Rescan')
  const [wallet] = mintWallets(1, folder.id)
  if (!wallet) throw new Error('mintWallets(1) returned no wallet')

  const contract = '0x00000000000000000000000000000000000000ee'
  await mockCollection(browser, {
    slug: 'mock-transfer-rescan',
    body: collectionFixture({
      slug: 'mock-transfer-rescan',
      name: 'Mock Rescan',
      contract,
    }),
  })
  const holdings = await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([{ contract, identifier: '1' }]),
  })
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    allowWrites: true,
    ethCall: { [SUPPORTS_INTERFACE]: word(1) },
  })

  await seedTransfer(app, browser, folder, wallet)
  await scanCollection({
    browser,
    screen,
    feature: 'transfer',
    collection: 'mock-transfer-rescan',
    folder: folder.name,
  })

  const token = screen.getByRole('checkbox', { name: 'Select token #1' })
  await expect(token).toBeEnabled()
  await token.check()
  await screen.getByLabel('Or paste an address').fill(DESTINATION)
  await screen.getByLabel('Or paste an address').press('Tab')
  await screen.getByRole('button', { name: 'Transfer 1 NFT' }).click()

  await expect.poll(() => rpc.count('eth_sendRawTransaction')).toBe(1)
  await expect(
    screen.getByRole('checkbox', { name: 'Select token #1' })
  ).toBeDisabled()

  await screen.getByRole('button', { name: 'Rescan' }).click()
  await expect.poll(() => holdings.count).toBe(2)

  await expect(screen.getByText('Sent', { exact: true })).toBeVisible()
  await expect(
    screen.getByRole('checkbox', { name: 'Select token #1' })
  ).toBeDisabled()
})
