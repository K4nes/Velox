import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { parseUnits } from 'viem'
import {
  mintWallets,
  openseaConnection,
  robinhoodRpc,
  walletFolder,
} from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture } from '../support/fixtures/holdings'
import { listingActionFixture } from '../support/fixtures/listing-actions'
import { mockCollection, mockHoldings } from '../support/opensea'
import { mockRpc } from '../support/rpc'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'approval-guard'
const CONTRACT = '0x00000000000000000000000000000000000000bb'
const CHAIN = 'robinhood'
const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395'
const ROGUE_OPERATOR = '0x00000000000000000000000000000000000000e1'
const RPC_URL = 'http://127.0.0.1:8545'
const CHAIN_ID = 4663

test('an approval for an unknown operator is refused before any send', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Approval Guard')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const submissions: string[] = []
  await browser.route(
    /\/api\/v2\/orders\/[^/]+\/seaport\/listings$/,
    async (route) => {
      submissions.push(route.request.url)
      await route.fulfill({ status: 500, json: {} })
    },
  )
  // The response asks the wallet to approve an operator no order settles on.
  // The plan has to reject it before the run touches a key.
  await browser.route(/\/api\/v2\/listings\/actions$/, async (route) => {
    const posted = JSON.parse(route.request.postData ?? '{}')
    const item = posted.items[0]
    const endTimeSec = Math.floor(new Date(item.end_time).getTime() / 1000)
    await route.fulfill({
      status: 200,
      json: listingActionFixture({
        offerer: posted.address,
        contract: item.contract,
        tokenId: item.token_id,
        chainId: CHAIN_ID,
        protocolAddress: SEAPORT,
        startTimeSec: endTimeSec - 86_400,
        endTimeSec,
        amountWei: (
          parseUnits(item.price.amount, 18) * BigInt(item.quantity)
        ).toString(),
        quantity: item.quantity,
        approval: { operator: ROGUE_OPERATOR },
      }),
    })
  })

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Approval Guard',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockHoldings(browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsFixture([{ contract: CONTRACT, identifier: '1' }]),
  })
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    allowWrites: true,
  })

  await app.open('/bulk-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [robinhoodRpc(RPC_URL), openseaConnection('deterministic-key')],
  })
  await app.open('/bulk-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'bulk-sell',
    collection: SLUG,
    folder: folder.name,
  })

  await screen.getByRole('checkbox', { name: 'Select token #1' }).check()
  await screen.getByLabel('Price per item · ETH').fill('0.01')
  const create = screen.getByRole('button', { name: 'Create listings' })
  await expect(create).toBeEnabled()
  await create.click()

  const refusal = browser
    .locator('p[role="alert"]')
    .filter({ hasText: /not a Seaport operator/ })
  await expect(refusal).toBeVisible()

  expect(submissions).toEqual([])
  expect(rpc.count('eth_sendRawTransaction')).toBe(0)
})
