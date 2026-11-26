import { test } from '@e2e-dev/web'
import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { JsonValue } from 'e2e'
import {
  coinmarketcapConnection,
  mintWallets,
  openseaConnection,
  walletFolder,
} from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { guardOpenSeaHost, mockCollection } from '../support/opensea'
import { mockPrice } from '../support/price'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'
import {
  mockBlockscout,
  type ExplorerTransaction,
  type ExplorerTransfer,
} from './blockscout'

const SELLER = `0x${'a1'.repeat(20)}`
const BUYER = `0x${'b2'.repeat(20)}`
const TOKEN_PAYMENT_CONTRACT = `0x${'c3'.repeat(20)}`
const USDC = `0x${'d4'.repeat(20)}`
const ERC1155_CONTRACT = `0x${'e5'.repeat(20)}`

const BUY_HASH = `0x${'11'.repeat(32)}`
const SELL_HASH = `0x${'22'.repeat(32)}`
const UNIT_BUY_HASH = `0x${'33'.repeat(32)}`
const UNIT_SELL_HASH = `0x${'44'.repeat(32)}`

const ETH = 10n ** 18n

type StoredRecord = {
  contract: string
  netPnl: string
  truncated: boolean
  unpriced: boolean
  breakdown?: {
    v: number
    realized: string
    spent: string
    basis: string
    held: number
    sold: number
  }
}

function isStoredRecord(value: JsonValue): value is StoredRecord {
  if (typeof value !== 'object' || value === null) return false
  return (
    'contract' in value &&
    typeof value.contract === 'string' &&
    'breakdown' in value
  )
}

async function readPnlRecords(browser: Browser): Promise<StoredRecord[]> {
  const body = await browser.evaluate(async (): Promise<{ rows: JsonValue[] }> => {
    const opened = Promise.withResolvers<IDBDatabase>()
    const request = indexedDB.open('velox')
    request.onsuccess = () => opened.resolve(request.result)
    request.onerror = () => opened.reject(request.error)
    const db = await opened.promise
    try {
      const rows = Promise.withResolvers<JsonValue[]>()
      const all = db
        .transaction('pnl-records', 'readonly')
        .objectStore('pnl-records')
        .getAll()
      all.onsuccess = () => rows.resolve(all.result as JsonValue[])
      all.onerror = () => rows.reject(all.error)
      return { rows: await rows.promise }
    } finally {
      db.close()
    }
  })

  return body.rows.filter(isStoredRecord)
}

test('a sale paid in another token is left out instead of booked at zero', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('PnL Token Payment')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')
  const address = wallet.address.toLowerCase()

  const bought: ExplorerTransfer = {
    hash: BUY_HASH,
    blockNumber: 100,
    from: SELLER,
    to: address,
    token: TOKEN_PAYMENT_CONTRACT,
    standard: 'ERC-721',
    tokenId: '1',
  }
  const sold: ExplorerTransfer = {
    hash: SELL_HASH,
    blockNumber: 101,
    from: address,
    to: BUYER,
    token: TOKEN_PAYMENT_CONTRACT,
    standard: 'ERC-721',
    tokenId: '1',
  }
  const usdcPayment: ExplorerTransfer = {
    hash: SELL_HASH,
    blockNumber: 101,
    from: BUYER,
    to: address,
    token: USDC,
    standard: 'ERC-20',
    units: 2_000_000_000,
    decimals: 6,
  }
  const transactions: Record<string, ExplorerTransaction> = {
    [BUY_HASH]: {
      hash: BUY_HASH,
      from: address,
      to: SELLER,
      value: ETH,
      transfers: [bought],
    },
    [SELL_HASH]: {
      hash: SELL_HASH,
      from: BUYER,
      to: TOKEN_PAYMENT_CONTRACT,
      transfers: [sold, usdcPayment],
    },
  }

  await guardOpenSeaHost(browser)
  await mockCollection(browser, {
    slug: 'token-payment-pnl',
    body: collectionFixture({
      slug: 'token-payment-pnl',
      name: 'Token Payment',
      contract: TOKEN_PAYMENT_CONTRACT,
    }),
  })
  await mockPrice(browser, { price: 2_000 })
  await mockBlockscout(browser, {
    // Newest first, the order the explorer lists them in.
    transfers: { [address]: [sold, bought] },
    transactions,
  })

  await app.open('/pnl/card')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [
      openseaConnection('deterministic-key'),
      coinmarketcapConnection('deterministic-key'),
    ],
  })
  await app.open('/pnl/card')
  await scanCollection({
    browser,
    screen,
    feature: 'pnl-card',
    collection: 'token-payment-pnl',
    folder: folder.name,
  })

  await expect(
    browser
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Some trades are left out because their payment is unclear' }),
  ).toBeVisible()

  // The priced buy keeps a lot, so the check still saves a row; the USDC sale
  // must not turn it into a complete zero.
  await expect.poll(async () => (await readPnlRecords(browser)).length).toBe(1)
  const [stored] = await readPnlRecords(browser)
  if (stored === undefined) throw new Error('the card saved no record')

  expect(stored.unpriced, 'the USDC sale was booked as a priced trade').toBe(true)
  expect(stored.truncated).toBe(false)
  expect(stored.netPnl).toBe('0')
  expect(stored.breakdown).toEqual({
    v: 2,
    realized: '0',
    spent: ETH.toString(),
    basis: ETH.toString(),
    held: 1,
    sold: 0,
  })
})

test('a 1155 sale is priced per unit and marks every open unit', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('PnL Unit Sale')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')
  const address = wallet.address.toLowerCase()

  const bought: ExplorerTransfer = {
    hash: UNIT_BUY_HASH,
    blockNumber: 200,
    from: SELLER,
    to: address,
    token: ERC1155_CONTRACT,
    standard: 'ERC-1155',
    tokenId: '7',
    units: 3,
  }
  const sold: ExplorerTransfer = {
    hash: UNIT_SELL_HASH,
    blockNumber: 201,
    from: address,
    to: BUYER,
    token: ERC1155_CONTRACT,
    standard: 'ERC-1155',
    tokenId: '7',
    units: 1,
  }
  const transactions: Record<string, ExplorerTransaction> = {
    [UNIT_BUY_HASH]: {
      hash: UNIT_BUY_HASH,
      from: address,
      to: SELLER,
      value: 3n * ETH,
      transfers: [bought],
    },
    [UNIT_SELL_HASH]: {
      hash: UNIT_SELL_HASH,
      from: BUYER,
      to: address,
      value: 2n * ETH,
      transfers: [sold],
    },
  }

  await guardOpenSeaHost(browser)
  await mockCollection(browser, {
    slug: 'unit-sale-pnl',
    body: collectionFixture({
      slug: 'unit-sale-pnl',
      name: 'Edition Sale',
      contract: ERC1155_CONTRACT,
    }),
  })
  await mockPrice(browser, { price: 2_000 })
  await mockBlockscout(browser, {
    transfers: { [address]: [sold, bought] },
    transactions,
  })

  await app.open('/pnl/card')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [
      openseaConnection('deterministic-key'),
      coinmarketcapConnection('deterministic-key'),
    ],
  })
  await app.open('/pnl/card')
  await scanCollection({
    browser,
    screen,
    feature: 'pnl-card',
    collection: 'unit-sale-pnl',
    folder: folder.name,
  })

  // Three units cost 3 ETH, one sells for 2 ETH, and the two still held are
  // marked at that last unit price: realized 1, current value 4.
  await expect(browser.locator('span:text-is("Realized") + span')).toContainText(
    '1.0000 ETH',
  )
  await expect(browser.locator('span:text-is("Invested") + span')).toContainText(
    '3.0000 ETH',
  )
  await expect(
    browser.locator('span:text-is("Current value") + span'),
  ).toContainText('4.0000 ETH')
  await expect(browser.locator('span:text-is("Total PnL") + span')).toContainText(
    '3.0000 ETH',
  )

  await expect.poll(async () => (await readPnlRecords(browser)).length).toBe(1)
  const [stored] = await readPnlRecords(browser)
  if (stored === undefined) throw new Error('the card saved no record')

  expect(stored.truncated).toBe(false)
  expect(stored.unpriced).toBe(false)
  expect(stored.netPnl).toBe((3n * ETH).toString())
  expect(stored.breakdown).toEqual({
    v: 2,
    realized: ETH.toString(),
    spent: (3n * ETH).toString(),
    basis: (2n * ETH).toString(),
    held: 2,
    sold: 1,
  })
})
