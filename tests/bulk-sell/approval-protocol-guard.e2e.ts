import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Screen } from 'e2e'
import type { Browser } from '@e2e-dev/web'
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

const SLUG = 'approval-protocol-guard'
const CONTRACT = '0x00000000000000000000000000000000000000bb'
const OTHER_CONTRACT = '0x00000000000000000000000000000000000000cc'
const CHAIN = 'robinhood'
const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395'
const ROGUE_OPERATOR = '0x00000000000000000000000000000000000000e1'
const RPC_URL = 'http://127.0.0.1:8545'
const CHAIN_ID = 4663

async function openTamperedListing(input: {
  app: { open(path: string): Promise<void> }
  browser: Browser
  screen: Screen
  protocolAddress: string
  approval: { operator: string; contract?: string }
}) {
  const folder = walletFolder('Approval Protocol Guard')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const submissions: string[] = []
  await input.browser.route(
    /\/api\/v2\/orders\/[^/]+\/seaport\/listings$/,
    async (route) => {
      submissions.push(route.request.url)
      await route.fulfill({ status: 500, json: {} })
    },
  )
  await input.browser.route(/\/api\/v2\/listings\/actions$/, async (route) => {
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
        protocolAddress: input.protocolAddress,
        startTimeSec: endTimeSec - 86_400,
        endTimeSec,
        amountWei: (
          parseUnits(item.price.amount, 18) * BigInt(item.quantity)
        ).toString(),
        quantity: item.quantity,
        approval: input.approval,
      }),
    })
  })

  await mockCollection(input.browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Approval Protocol Guard',
      contract: CONTRACT,
      chain: CHAIN,
    }),
  })
  await mockHoldings(input.browser, {
    chain: CHAIN,
    address: wallet.address,
    body: holdingsFixture([{ contract: CONTRACT, identifier: '1' }]),
  })
  const rpc = await mockRpc(input.browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    allowWrites: true,
  })

  await input.app.open('/bulk-sell')
  await seedVelox(input.browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [robinhoodRpc(RPC_URL), openseaConnection('deterministic-key')],
  })
  await input.app.open('/bulk-sell')
  await scanCollection({
    browser: input.browser,
    screen: input.screen,
    feature: 'bulk-sell',
    collection: SLUG,
    folder: folder.name,
  })

  await input.screen.getByRole('checkbox', { name: 'Select token #1' }).check()
  await input.screen.getByLabel('Price per item · ETH').fill('0.01')
  await input.screen.getByRole('button', { name: 'Create listings' }).click()

  return { submissions, rpc }
}

test('a protocol address outside the known Seaport list is refused', async ({
  app,
  browser,
  screen,
}) => {
  const { submissions, rpc } = await openTamperedListing({
    app,
    browser,
    screen,
    protocolAddress: ROGUE_OPERATOR,
    approval: { operator: ROGUE_OPERATOR },
  })

  await expect(
    browser
      .locator('p[role="alert"]')
      .filter({ hasText: /not a known Seaport/ })
  ).toBeVisible()
  expect(submissions).toEqual([])
  expect(rpc.count('eth_sendRawTransaction')).toBe(0)
})

test('an approval for a contract outside the selected batch is refused', async ({
  app,
  browser,
  screen,
}) => {
  const { submissions, rpc } = await openTamperedListing({
    app,
    browser,
    screen,
    protocolAddress: SEAPORT,
    approval: { operator: SEAPORT, contract: OTHER_CONTRACT },
  })

  await expect(
    browser
      .locator('p[role="alert"]')
      .filter({ hasText: /not a selected token contract/ })
  ).toBeVisible()
  expect(submissions).toEqual([])
  expect(rpc.count('eth_sendRawTransaction')).toBe(0)
})
