import { test } from '@e2e-dev/web'
import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'
import {
  clearVeloxStores,
  countVeloxRows,
  readVeloxRows,
  seedLegacyProfile,
} from '../support/db'
import type { LegacyConnection, LegacyPnlRecord } from '../support/db'
import { seedVelox } from '../support/seed'

const AT = 1_760_000_000_000
const DAY = '2026-01-05'
const NEXT_DAY = '2026-01-06'
const CONTRACT = `0x${'Ab'.repeat(20)}`
const CONTRACT_KEY = CONTRACT.toLowerCase()
const WALLET_A = `0x${'11'.repeat(20)}`
const WALLET_B = `0x${'22'.repeat(20)}`
// Assembled from parts so the fixture does not read as a live credential.
const OPEN_SEA_KEY = ['fixture', 'opensea', '1234'].join('-')
const ETH_RPC = 'https://ethereum.example/rpc/legacy'
const BASE_RPC = 'https://base.example/rpc/legacy'

type ConnectionRow = {
  id: string
  provider?: string
  credentials: { id: string; value: string }[]
  endpoints?: { chain: string; url: string }[]
}

type PnlRow = {
  id: string
  name: string
  netPnl: string
  wallets: string[]
}

/**
 * Static asset on the app's origin: enough to run `indexedDB` without booting
 * the app, which would open the database at the current version first.
 */
async function openSeedPage(browser: Browser): Promise<void> {
  await browser.goto('/velox-logo.png')
}

test('v5 → v7: QuickNode and custom RPC rows are retired', async ({
  app,
  browser,
  screen,
}) => {
  const seeded: LegacyConnection[] = [
    {
      kind: 'data-api',
      id: 'opensea',
      name: 'OpenSea',
      order: 0,
      autoFallback: true,
      credentials: [],
      updatedAt: AT,
    },
    {
      kind: 'data-api',
      id: 'coinmarketcap',
      name: 'CoinMarketCap',
      order: 1,
      autoFallback: true,
      credentials: [],
      updatedAt: AT,
    },
    {
      kind: 'rpc',
      id: 'rpc:alchemy',
      name: 'Alchemy',
      provider: 'alchemy',
      order: 2,
      autoFallback: true,
      credentials: [],
      endpoints: [],
      updatedAt: AT,
    },
    {
      kind: 'rpc',
      id: 'rpc:ankr',
      name: 'Ankr',
      provider: 'ankr',
      order: 3,
      autoFallback: true,
      credentials: [],
      endpoints: [],
      updatedAt: AT,
    },
    {
      kind: 'rpc',
      id: 'rpc:quicknode',
      name: 'QuickNode',
      provider: 'quicknode',
      order: 4,
      autoFallback: true,
      credentials: [],
      endpoints: [],
      updatedAt: AT,
    },
    {
      kind: 'rpc',
      id: 'rpc:quicknode:kept',
      name: 'QuickNode (kept)',
      provider: 'quicknode',
      order: 5,
      autoFallback: false,
      credentials: [{ id: 'quicknode-key', value: 'quicknode-key-1234' }],
      endpoints: [
        {
          id: 'quicknode-endpoint',
          chain: 'ethereum',
          url: 'https://example.quicknode.com/quicknode-key-1234',
          probe: null,
        },
      ],
      updatedAt: AT,
    },
  ]

  await openSeedPage(browser)
  await seedLegacyProfile(browser, {
    version: 5,
    secrets: [],
    pnlRecords: [],
    connections: seeded,
  })

  await app.open('/settings')
  await expect(
    screen.getByRole('button', { name: /QuickNode/ }),
  ).toHaveCount(0)

  const rows = await readVeloxRows<ConnectionRow>(browser, 'connections')
  expect(
    rows.map((row) => ({ id: row.id, provider: row.provider ?? null })),
  ).toEqual([
    { id: 'coinmarketcap', provider: null },
    { id: 'opensea', provider: null },
    { id: 'rpc:alchemy', provider: 'alchemy' },
    { id: 'rpc:ankr', provider: 'ankr' },
  ])
})

test('v3 → v7: legacy secrets become the OpenSea key; legacy RPC URLs are dropped', async ({
  app,
  browser,
  screen,
}) => {
  await openSeedPage(browser)
  await seedLegacyProfile(browser, {
    version: 3,
    secrets: [
      { id: 'opensea-api-key', value: OPEN_SEA_KEY },
      { id: 'rpc:ethereum', value: ETH_RPC },
      { id: 'rpc:base', value: BASE_RPC },
    ],
    pnlRecords: [],
    connections: [],
  })

  await app.open('/settings')
  await expect(screen.getByRole('button', { name: /OpenSea/ })).toContainText(
    '1234',
  )

  const rows = await readVeloxRows<ConnectionRow>(browser, 'connections')
  expect(
    rows.map((row) => ({
      id: row.id,
      credentials: (row.credentials ?? []).map((credential) => credential.value),
      endpoints: (row.endpoints ?? []).map(
        (endpoint) => `${endpoint.chain} ${endpoint.url}`,
      ),
    })),
  ).toEqual([
    { id: 'coinmarketcap', credentials: [], endpoints: [] },
    { id: 'opensea', credentials: [OPEN_SEA_KEY], endpoints: [] },
    { id: 'rpc:alchemy', credentials: [], endpoints: [] },
    { id: 'rpc:ankr', credentials: [], endpoints: [] },
  ])
})

test('v3 → v7: same-day PnL rows merge per contract and day, keeping the complete read', async ({
  app,
  browser,
  screen,
}) => {
  const complete: LegacyPnlRecord = {
    id: `${CONTRACT}|wallet-a|${DAY}`,
    createdAt: AT,
    day: DAY,
    slug: 'mock-collection',
    name: 'Complete read',
    imageUrl: '',
    chain: 'robinhood',
    contract: CONTRACT,
    wallets: [WALLET_A],
    netPnl: '111',
    ethPriceUsd: 2_000,
    truncated: false,
    unpriced: false,
  }
  const partial: LegacyPnlRecord = {
    ...complete,
    id: `${CONTRACT}|wallet-b|${DAY}`,
    createdAt: AT + 1_000,
    name: 'Partial read',
    wallets: [WALLET_B],
    netPnl: '222',
    truncated: true,
  }
  const nextDay: LegacyPnlRecord = {
    ...complete,
    id: `${CONTRACT}|wallet-a|${NEXT_DAY}`,
    day: NEXT_DAY,
    createdAt: AT - 1_000,
    name: 'Next day',
    netPnl: '333',
  }

  await openSeedPage(browser)
  await seedLegacyProfile(browser, {
    version: 3,
    secrets: [],
    pnlRecords: [complete, partial, nextDay],
    connections: [],
  })

  await app.open('/settings')
  await expect(screen.getByRole('button', { name: /OpenSea/ })).toBeVisible()

  const rows = await readVeloxRows<PnlRow>(browser, 'pnl-records')
  expect(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      netPnl: row.netPnl,
      wallets: row.wallets,
    })),
  ).toEqual([
    {
      id: `${CONTRACT_KEY}|${DAY}`,
      name: 'Complete read',
      netPnl: '111',
      wallets: [WALLET_A],
    },
    {
      id: `${CONTRACT_KEY}|${NEXT_DAY}`,
      name: 'Next day',
      netPnl: '333',
      wallets: [WALLET_A],
    },
  ])
})

test('clearing the profile empties the snapshots store', async ({
  app,
  browser,
}) => {
  await app.open('/settings')
  await seedVelox(browser, { snapshots: [{ id: 'snapshot-1' }] })

  await browser.evaluate(clearVeloxStores)

  expect(await browser.evaluate(countVeloxRows, 'snapshots')).toBe(0)
})

test('v6 → v7: custom rows are deleted and a pasted provider key survives', async ({
  app,
  browser,
  screen,
}) => {
  const pastedKey = ['pasted', 'key', '1234'].join('-')
  const seeded: LegacyConnection[] = [
    {
      kind: 'rpc',
      id: 'rpc:alchemy',
      name: 'Alchemy',
      provider: 'alchemy',
      order: 2,
      autoFallback: true,
      credentials: [],
      endpoints: [
        {
          id: 'eth-endpoint',
          chain: 'ethereum',
          url: `https://eth-mainnet.g.alchemy.com/v2/${pastedKey}/`,
          probe: null,
        },
        {
          id: 'base-endpoint',
          chain: 'base',
          url: 'https://base-mainnet.g.alchemy.com',
          probe: null,
        },
        {
          id: 'unknown-endpoint',
          chain: 'mystery',
          url: 'https://example.invalid/rpc',
          probe: null,
        },
        {
          id: 'literal-template',
          chain: 'ape_chain',
          url: 'https://apechain-mainnet.g.alchemy.com/v2/{key}/',
          probe: null,
        },
      ],
      updatedAt: AT,
    },
    {
      kind: 'rpc',
      id: 'rpc:ankr',
      name: 'Ankr',
      provider: 'ankr',
      order: 3,
      autoFallback: true,
      credentials: [],
      endpoints: [
        {
          id: 'ankr-bare',
          chain: 'ethereum',
          url: 'https://rpc.ankr.com/eth',
          probe: null,
        },
        {
          id: 'ankr-foreign',
          chain: 'base',
          url: 'https://my-node.example/rpc',
          probe: null,
        },
      ],
      updatedAt: AT,
    },
    {
      kind: 'rpc',
      id: 'rpc:custom:legacy',
      name: 'Custom RPC',
      provider: 'custom',
      order: 4,
      autoFallback: true,
      credentials: [],
      endpoints: [
        {
          id: 'custom-eth',
          chain: 'ethereum',
          url: 'https://my-node.example/rpc',
          probe: null,
        },
      ],
      updatedAt: AT,
    },
  ]

  await openSeedPage(browser)
  await seedLegacyProfile(browser, {
    version: 6,
    secrets: [],
    pnlRecords: [],
    connections: seeded,
  })

  await app.open('/settings')
  await expect(
    screen.getByRole('button', { name: /Custom RPC/ }),
  ).toHaveCount(0)

  const rows = await readVeloxRows<ConnectionRow>(browser, 'connections')
  expect(
    rows
      .map((row) => ({
        id: row.id,
        credentials: (row.credentials ?? []).map((credential) => credential.value),
        endpoints: (row.endpoints ?? []).map(
          (endpoint) => `${endpoint.chain} ${endpoint.url}`,
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual([
    {
      id: 'rpc:alchemy',
      credentials: [pastedKey],
      endpoints: [
        'ethereum https://eth-mainnet.g.alchemy.com/v2/{key}',
        'base https://base-mainnet.g.alchemy.com/v2/{key}',
        'ape_chain https://apechain-mainnet.g.alchemy.com/v2/{key}',
      ],
    },
    { id: 'rpc:ankr', credentials: [], endpoints: [] },
  ])
})
