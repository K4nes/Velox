import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import {
  mintWallets,
  openseaConnection,
  walletFolder,
  robinhoodRpc,
} from '../support/data'
import { holdingsFixture } from '../support/fixtures/holdings'
import {
  expectHeldInventoryHeader,
  filterHeldInventory,
} from '../support/inventory'
import { collectionFixture } from '../support/fixtures/collection'
import { mockCollection, mockHoldings } from '../support/opensea'
import { mockRpc, word } from '../support/rpc'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'mock-transfer'
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const RPC_URL = 'http://127.0.0.1:8545'
const DESTINATION = '0x0000000000000000000000000000000000000001'
const SUPPORTS_INTERFACE = '0x01ffc9a7'

test('a pasted destination arms the transfer', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Transfer')
  const [wallet] = mintWallets(1, folder.id)

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Mock Transfer',
      contract: CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([
      { contract: CONTRACT, identifier: '1' },
      { contract: CONTRACT, identifier: '2' },
      { contract: CONTRACT, identifier: '3' },
    ]),
  })
  // The scan probes ERC-165 before a row is selectable; a 32-byte word with the
  // low byte `01` decodes as `true`, so the probe resolves to ERC-721.
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    ethCall: { [SUPPORTS_INTERFACE]: word(1) },
  })

  await app.open('/transfer')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [robinhoodRpc(RPC_URL), openseaConnection('deterministic-key')],
  })
  await app.open('/transfer')

  await scanCollection({
    browser,
    screen,
    feature: 'transfer',
    collection: SLUG,
    folder: folder.name,
  })

  await expect(
    screen.getByRole('button', { name: 'Select NFTs to transfer' })
  ).toBeDisabled()

  const token = screen.getByRole('checkbox', { name: 'Select token #1' })
  await expect(token).toBeEnabled()
  await token.check()

  const button = screen.getByRole('button', { name: 'Transfer 1 NFT' })
  await expect(button).toBeDisabled()

  await screen.getByLabel('Or paste an address').fill(DESTINATION)
  await screen.getByLabel('Or paste an address').press('Tab')

  await expect(screen.getByText('Sends to 0x0000…0001')).toBeVisible()
  await expect(button).toBeEnabled()
  expect(rpc.count('eth_sendRawTransaction')).toBe(0)

  await expectHeldInventoryHeader(screen, 3)
  await filterHeldInventory(screen, '#2')
})
