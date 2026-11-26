import { test } from '@e2e-dev/web'
import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { JsonValue } from 'e2e'
import { parseUnits } from 'viem'
import {
  mintWallets,
  openseaConnection,
  robinhoodRpc,
  walletFolder,
} from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture } from '../support/fixtures/holdings'
import { collectionOfferFixture, offerFulfillmentFixture } from '../support/fixtures/offers'
import type { CollectionOfferFixture } from '../support/fixtures/offers'
import {
  guardOpenSeaHost,
  mockCollection,
  mockCollectionOffers,
  mockHoldings,
} from '../support/opensea'
import { mockRpc, word } from '../support/rpc'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'

const SLUG = 'instant-units'
const CONTRACT = '0x00000000000000000000000000000000000000bb'
const TOKEN_ID = '1'
const CHAIN_ID = 4663
const RPC_URL = 'http://127.0.0.1:8545'
const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395'
const ROGUE_PROTOCOL = '0x00000000000000000000000000000000000000e1'
const IS_APPROVED_FOR_ALL = '0xe985e9c5'
const UNIT_PRICE = parseUnits('0.1', 18)
const UNIT_FEE = parseUnits('0.01', 18)

type FulfillmentRequest = { units_to_fill: unknown }

async function mockFulfillment(
  browser: Browser,
  options: {
    offer: CollectionOfferFixture
    fulfiller: string
    units: number
    bodies: FulfillmentRequest[]
  },
): Promise<void> {
  await browser.route(/\/api\/v2\/offers\/fulfillment_data$/, async (route) => {
    options.bodies.push(
      JSON.parse(route.request.postData ?? '{}') as FulfillmentRequest,
    )
    await route.fulfill({
      status: 200,
      json: offerFulfillmentFixture({
        offer: options.offer,
        chainId: CHAIN_ID,
        fulfiller: options.fulfiller,
        tokenId: TOKEN_ID,
        units: options.units,
      }) as unknown as JsonValue,
    })
  })
}

test('a five-unit token fills a five-unit bid in one sale', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Instant Units Five')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const bodies: FulfillmentRequest[] = []
  const offer = collectionOfferFixture({
    contract: CONTRACT,
    protocolAddress: SEAPORT,
    pricePerUnitWei: UNIT_PRICE,
    feePerUnitWei: UNIT_FEE,
    remaining: 5,
  })

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Instant Units',
      contract: CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([
      { contract: CONTRACT, identifier: TOKEN_ID, quantity: 5 },
    ]),
  })
  await mockCollectionOffers(browser, {
    slug: SLUG,
    body: { offers: [offer], next: null } as unknown as JsonValue,
  })
  await mockFulfillment(browser, {
    offer,
    fulfiller: wallet.address,
    units: 5,
    bodies,
  })
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    ethCall: { [IS_APPROVED_FOR_ALL]: word(1) },
    allowWrites: true,
  })

  await app.open('/instant-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [robinhoodRpc(RPC_URL), openseaConnection('deterministic-key')],
  })
  await app.open('/instant-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'instant-sell',
    collection: SLUG,
    folder: folder.name,
  })
  await screen.getByRole('checkbox', { name: `Select token #${TOKEN_ID}` }).check()

  const accept = screen.getByRole('button', { name: 'Accept 1 offer' })
  await expect(accept).toBeEnabled()
  // The rail prices the planned units, not one unit: 5 × 0.1 gross, 5 × 0.01 fee.
  await expect(screen.getByText('-0.05 ETH')).toBeVisible()
  await accept.click()

  await expect(screen.getByText(/1 of 1 sold/)).toBeVisible()
  await expect(screen.getByText(/0\.45 ETH/)).toBeVisible()
  expect(bodies).toHaveLength(1)
  expect(bodies[0]?.units_to_fill).toBe(5)
  expect(typeof bodies[0]?.units_to_fill).toBe('number')
  expect(rpc.count('eth_sendRawTransaction')).toBe(1)
})

test('a two-unit bid fills two of five and leaves the rest sellable', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Instant Units Two')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const bodies: FulfillmentRequest[] = []
  // A five-unit order with two units left: the order's own terms keep the five,
  // the book reports the remaining depth, and the fill is the two-unit fraction.
  const offer = collectionOfferFixture({
    contract: CONTRACT,
    protocolAddress: SEAPORT,
    pricePerUnitWei: UNIT_PRICE,
    quantity: 5,
    remaining: 2,
  })

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Instant Units',
      contract: CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([
      { contract: CONTRACT, identifier: TOKEN_ID, quantity: 5 },
    ]),
  })
  await mockCollectionOffers(browser, {
    slug: SLUG,
    body: { offers: [offer], next: null } as unknown as JsonValue,
  })
  await mockFulfillment(browser, {
    offer,
    fulfiller: wallet.address,
    units: 2,
    bodies,
  })
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    ethCall: { [IS_APPROVED_FOR_ALL]: word(1) },
    allowWrites: true,
  })

  await app.open('/instant-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [robinhoodRpc(RPC_URL), openseaConnection('deterministic-key')],
  })
  await app.open('/instant-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'instant-sell',
    collection: SLUG,
    folder: folder.name,
  })
  const box = screen.getByRole('checkbox', {
    name: `Select token #${TOKEN_ID}`,
  })
  await box.check()
  await screen.getByRole('button', { name: 'Accept 1 offer' }).click()

  await expect(screen.getByText(/^2 of 5 sold/)).toBeVisible()
  await expect(box).toBeEnabled()
  expect(bodies[0]?.units_to_fill).toBe(2)
  expect(rpc.count('eth_sendRawTransaction')).toBe(1)
})

test('an offer on an unknown protocol never reaches an approval', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Instant Units Rogue')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const bodies: FulfillmentRequest[] = []
  const offer = collectionOfferFixture({
    contract: CONTRACT,
    protocolAddress: ROGUE_PROTOCOL,
    pricePerUnitWei: UNIT_PRICE,
    remaining: 1,
  })

  await guardOpenSeaHost(browser)
  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Instant Units',
      contract: CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([{ contract: CONTRACT, identifier: TOKEN_ID }]),
  })
  await mockCollectionOffers(browser, {
    slug: SLUG,
    body: { offers: [offer], next: null } as unknown as JsonValue,
  })
  await mockFulfillment(browser, {
    offer,
    fulfiller: wallet.address,
    units: 1,
    bodies,
  })
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    allowWrites: true,
  })

  await app.open('/instant-sell')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [robinhoodRpc(RPC_URL), openseaConnection('deterministic-key')],
  })
  await app.open('/instant-sell')

  await scanCollection({
    browser,
    screen,
    feature: 'instant-sell',
    collection: SLUG,
    folder: folder.name,
  })
  await screen.getByRole('checkbox', { name: `Select token #${TOKEN_ID}` }).check()
  await screen.getByRole('button', { name: 'Accept 1 offer' }).click()

  await expect(
    browser.locator('span[title*="Unsupported Seaport contract"]'),
  ).toBeVisible()
  // The fulfillment request is what the run answers from, so its arrival proves
  // the whitelist refused the approval rather than the response being malformed.
  expect(bodies).toHaveLength(1)
  expect(rpc.count('eth_sendRawTransaction')).toBe(0)
})
