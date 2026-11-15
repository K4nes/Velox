import { test } from '@e2e-dev/web'
import type { Browser, WebApp } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Screen } from 'e2e'
import {
  mintWallets,
  openseaConnection,
  walletFolder,
  walletRow,
} from '../support/data'
import { dropFixture } from '../support/fixtures/drop'
import { mockScatterNetwork } from '../support/mint'
import {
  guardOpenSeaHost,
  mockAuth,
  mockCollection,
  mockDrop,
  mockEligibility,
} from '../support/opensea'
import { seedVelox } from '../support/seed'
import type { FolderRow, Seed, WalletRow } from '../support/seed'

const SLUG = 'mock-drop'
const COLLECTION_URL = `https://opensea.io/collection/${SLUG}`
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const AUTH_TOKEN = 'e2e-eligibility-token'

// The drop reports an undashed id while eligibility reports the dashed form;
// the app matches the two after removing the dashes.
const STAGE_ID = '01234567-89ab-cdef-0123-456789abcdef'

async function openEligibilityWith(
  app: WebApp,
  browser: Browser,
  seed: Seed,
): Promise<void> {
  await app.open('/mint/eligibility')
  await seedVelox(browser, seed)
  await app.open('/mint/eligibility')
}

async function checkScatterCollection(
  browser: Browser,
  screen: Screen,
  options: { slug: string; folder: FolderRow },
): Promise<void> {
  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill(`https://scatter.art/c/${options.slug}`)
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${options.folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
  await screen.getByRole('button', { name: 'Check' }).click()
}

/** Fails every matching request and counts it, so a route the code should not call cannot reach the network. */
async function countAbortedRequests(
  browser: Browser,
  pattern: string,
): Promise<() => number> {
  let count = 0
  await browser.route(pattern, async (route) => {
    count += 1
    await route.abort()
  })
  return () => count
}

/** A snapshot as the pre-Scatter version wrote it: no `drop.source`, only a regex label. */
function legacySnapshot(options: {
  id: string
  marketplace: string
  name: string
  createdAt: number
  wallet: WalletRow
}) {
  const uuid = STAGE_ID.replaceAll('-', '')
  return {
    id: options.id,
    createdAt: options.createdAt,
    slug: SLUG,
    marketplace: options.marketplace,
    chainName: 'Robinhood',
    drop: {
      slug: SLUG,
      name: options.name,
      chain: 'robinhood',
      contractAddress: CONTRACT,
      dropType: 'seadrop_v1_erc721',
      isMinting: true,
      maxSupply: '100',
      totalSupply: '1',
      activeStage: null,
      nextStage: null,
      stages: [
        {
          uuid,
          stageType: 'public',
          label: 'Public',
          priceWei: '0',
          maxPerWallet: '1',
          startTime: '',
          endTime: '',
        },
      ],
    },
    imageUrl: '',
    stageColumns: [{ uuid, label: 'Public' }],
    rows: [
      {
        walletId: options.wallet.id,
        label: options.wallet.label,
        address: options.wallet.address,
        stages: [
          {
            stageUuid: uuid,
            label: 'Public',
            eligible: true,
            maxMintable: '1',
            priceWei: '0',
          },
        ],
      },
    ],
  }
}

function pickWallets(count: number, folderId: string): WalletRow[] {
  const wallets = mintWallets(count, folderId)
  if (wallets.length !== count) {
    throw new Error(`mintWallets(${count}) returned ${wallets.length}`)
  }
  return wallets
}

test('an eligible wallet renders and saves a snapshot', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility')
  const [wallet] = mintWallets(1, folder.id)
  const drop = dropFixture({
    slug: SLUG,
    contract: CONTRACT,
    totalSupply: '1',
    stages: [
      {
        uuid: STAGE_ID.replaceAll('-', ''),
        label: 'Public',
        maxPerWallet: '1',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      },
    ],
  })

  await guardOpenSeaHost(browser)
  const drops = await mockDrop(browser, { slug: SLUG, body: drop })
  const collection = await mockCollection(browser, {
    slug: SLUG,
    body: {
      collection: SLUG,
      name: 'Mock Drop',
      image_url: '',
      contracts: [{ address: CONTRACT, chain: 'robinhood' }],
      total_supply: 1,
    },
  })
  const eligibility = await mockEligibility(browser, {
    slug: SLUG,
    token: AUTH_TOKEN,
    body: {
      stages: [
        {
          stage_uuid: STAGE_ID,
          is_eligible: true,
          max_total_mintable_by_wallet: '1',
          price: '0',
        },
      ],
    },
  })
  const auth = await mockAuth(browser, { token: AUTH_TOKEN })

  await app.open('/mint/eligibility')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/mint/eligibility')

  await expect(screen.getByText('Select at least one wallet')).toBeVisible()

  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill(COLLECTION_URL)
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')

  await screen.getByRole('button', { name: 'Check' }).click()

  // One header row plus exactly one result row, whose stage cell is Eligible.
  await expect(screen.getByRole('row')).toHaveCount(2)
  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row).toHaveCount(1)
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible()

  await screen.getByRole('button', { name: 'Save snapshot' }).click()
  await screen.getByRole('tab', { name: 'Snapshot' }).click()

  await expect(browser.locator('[data-snapshot-id]')).toHaveCount(1)
  await expect(
    screen.getByRole('button', { name: 'View Snapshot' })
  ).toHaveCount(1)

  expect(collection.count).toBe(1)
  expect(drops.count).toBe(1)
  expect(eligibility.count).toBe(1)
  expect(auth.nonce.count).toBe(1)
  expect(auth.token.count).toBe(1)
})

test('page state survives a round trip while the check is running', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility Keep')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const drop = dropFixture({
    slug: SLUG,
    contract: CONTRACT,
    totalSupply: '1',
    stages: [
      {
        uuid: STAGE_ID.replaceAll('-', ''),
        label: 'Public',
        maxPerWallet: '1',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-02T00:00:00.000Z',
      },
    ],
  })

  await guardOpenSeaHost(browser)
  await mockDrop(browser, { slug: SLUG, body: drop })
  await mockCollection(browser, {
    slug: SLUG,
    body: {
      collection: SLUG,
      name: 'Mock Drop',
      image_url: '',
      contracts: [{ address: CONTRACT, chain: 'robinhood' }],
      total_supply: 1,
    },
  })
  await mockAuth(browser, { token: AUTH_TOKEN })

  // Holds the eligibility answer, so the check is still running while the
  // operator visits another page.
  const released = Promise.withResolvers<void>()
  await browser.route(
    new RegExp(`/api/v2/drops/${SLUG}/eligibility$`),
    async (route) => {
      await released.promise
      await route.fulfill({
        status: 200,
        json: {
          stages: [
            {
              stage_uuid: STAGE_ID,
              is_eligible: true,
              max_total_mintable_by_wallet: '1',
              price: '0',
            },
          ],
        },
      })
    },
  )

  await app.open('/mint/eligibility')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/mint/eligibility')

  await screen.getByLabel('Collection URL or slug (OpenSea / Scatter)').fill(COLLECTION_URL)
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
  await screen.getByRole('button', { name: 'Check' }).click()
  await expect(screen.getByRole('button', { name: /Check/ })).toBeDisabled()

  await browser.locator('a[href="/settings"]').first().click()
  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveCount(0)
  await browser.locator('a[href="/mint/eligibility"]').first().click()
  await expect(browser).toHaveURL('/mint/eligibility')

  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveValue(COLLECTION_URL)
  await expect(
    screen.getByRole('button', { name: /Select wallets/ }),
  ).toHaveText('Select wallets (1 selected)')
  await expect(screen.getByRole('button', { name: /Check/ })).toBeDisabled()

  released.resolve()
  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible()

  await browser.locator('a[href="/settings"]').first().click()
  await browser.locator('a[href="/mint/eligibility"]').first().click()

  await expect(
    screen.getByLabel('Collection URL or slug (OpenSea / Scatter)'),
  ).toHaveValue(COLLECTION_URL)
  await expect(
    screen.getByRole('button', { name: /Select wallets/ }),
  ).toHaveText('Select wallets (1 selected)')
  await expect(
    screen.getByRole('row').filter({ hasText: wallet.address }),
  ).toContainText('Eligible')
})

test('a Scatter URL produces Scatter rows instead of an OpenSea read', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility Scatter')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  const calls = await mockScatterNetwork({
    browser,
    slug: 'scatter-eligibility',
    lists: [
      {
        id: 'friends',
        name: 'Friends Discount',
        currencySymbol: 'USDC',
        decimals: 6,
      },
    ],
  })

  await app.open('/mint/eligibility')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await app.open('/mint/eligibility')

  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill('https://scatter.art/c/scatter-eligibility')
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  // The label comes from the source that answered, not from the OpenSea reader.
  await expect(screen.getByText('Scatter', { exact: true })).toBeVisible()

  expect(calls.collections).toEqual(['scatter-eligibility'])
  // One bare read builds the public columns; the second read asks what this wallet
  // can enter, which is the only answer eligibility can come from.
  expect(calls.lists.map((call) => call.minter)).toEqual([null, wallet.address])
})

test('a private list one wallet can enter becomes a column every row answers', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility Union')
  const [first, second, third] = pickWallets(3, folder.id)
  if (!first || !second || !third) throw new Error('three wallets required')

  // The address is the identity the API sees, so a second record for one address
  // must spend one read and produce one row.
  const duplicate = walletRow({
    label: 'union-duplicate',
    privateKey: first.privateKey,
    folderId: folder.id,
  })
  const now = Date.now()

  const calls = await mockScatterNetwork({
    browser,
    slug: 'scatter-union',
    lists: [
      { id: 'public', name: 'Public' },
      {
        id: 'friends',
        name: 'Friends Discount',
        private: true,
        startTime: new Date(now - 90_000).toISOString(),
      },
      {
        id: 'vip',
        name: 'VIP',
        private: true,
        startTime: new Date(now - 30_000).toISOString(),
      },
    ],
    eligible: (minter) => {
      const address = (minter ?? '').toLowerCase()
      if (address === first.address.toLowerCase()) return ['friends']
      if (address === third.address.toLowerCase()) return ['vip']
      return []
    },
  })

  await openEligibilityWith(app, browser, {
    folders: [folder],
    wallets: [first, duplicate, second, third],
    connections: [openseaConnection('deterministic-key')],
  })
  await checkScatterCollection(browser, screen, {
    slug: 'scatter-union',
    folder,
  })

  const firstRow = screen.getByRole('row').filter({ hasText: first.address })
  await expect(firstRow.getByText('Eligible', { exact: true })).toHaveCount(2, {
    timeout: 60_000,
  })
  // One header plus one row per unique address, not per record.
  await expect(screen.getByRole('row')).toHaveCount(4)

  for (const header of ['Public', 'Friends Discount', 'VIP']) {
    await expect(
      screen.getByRole('columnheader', { name: header }),
    ).toBeVisible()
  }

  const ledger = [
    { wallet: first, eligible: 2, missing: 1 },
    { wallet: second, eligible: 1, missing: 2 },
    { wallet: third, eligible: 2, missing: 1 },
  ]
  for (const entry of ledger) {
    const row = screen.getByRole('row').filter({ hasText: entry.wallet.address })
    await expect(row).toHaveCount(1)
    await expect(row.getByText('Eligible', { exact: true })).toHaveCount(
      entry.eligible,
    )
    await expect(row.getByText('Not eligible', { exact: true })).toHaveCount(
      entry.missing,
    )
    // A checked row answered for every column; a dash would mean it did not.
    await expect(row.getByText('—')).toHaveCount(0)
  }
  await expect(screen.getByText('Blocked')).toHaveCount(0)

  expect(calls.collections).toEqual(['scatter-union'])
  const walletReads = calls.lists.filter((call) => call.minter !== null)
  expect(calls.lists.filter((call) => call.minter === null)).toHaveLength(1)
  expect(walletReads.map((call) => (call.minter ?? '').toLowerCase()).sort()).toEqual(
    [first, second, third]
      .map((wallet) => wallet.address.toLowerCase())
      .sort(),
  )
  const gaps = walletReads
    .slice(1)
    .map((call, index) => call.at - walletReads[index].at)
  expect(gaps.every((gap) => gap >= 200)).toBe(true)
})

test('one wallet failing mid-run leaves the other rows checked', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility Failure')
  const [first, second, third] = pickWallets(3, folder.id)
  if (!first || !second || !third) throw new Error('three wallets required')

  const calls = await mockScatterNetwork({
    browser,
    slug: 'scatter-failure',
    lists: [{ id: 'public', name: 'Public' }],
    failMinters: [second.address],
  })

  await openEligibilityWith(app, browser, {
    folders: [folder],
    wallets: [first, second, third],
    connections: [openseaConnection('deterministic-key')],
  })
  await checkScatterCollection(browser, screen, {
    slug: 'scatter-failure',
    folder,
  })

  const failedRow = screen.getByRole('row').filter({ hasText: second.address })
  await expect(failedRow.getByText('Scatter list read failed')).toBeVisible({
    timeout: 60_000,
  })
  // A failed read earns no verdict, so the row never claims ineligibility.
  await expect(failedRow.getByText('Eligible', { exact: true })).toHaveCount(0)
  await expect(failedRow.getByText('Not eligible', { exact: true })).toHaveCount(0)

  for (const wallet of [first, third]) {
    await expect(
      screen
        .getByRole('row')
        .filter({ hasText: wallet.address })
        .getByText('Eligible', { exact: true }),
    ).toBeVisible()
  }

  expect(calls.collections).toHaveLength(1)
  // The third wallet was read after the second one failed.
  expect(calls.lists.filter((call) => call.minter !== null)).toHaveLength(3)
})

test('a saved Scatter snapshot reloads and refreshes through Scatter', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility Refresh')
  const [first, second] = pickWallets(2, folder.id)
  if (!first || !second) throw new Error('two wallets required')

  // The mock reads this map on every list call, so a refresh sees the new grant.
  const grants = new Map<string, string[]>([
    [first.address.toLowerCase(), ['friends']],
  ])

  const calls = await mockScatterNetwork({
    browser,
    slug: 'scatter-refresh',
    lists: [
      { id: 'public', name: 'Public' },
      { id: 'friends', name: 'Friends Discount', private: true },
    ],
    eligible: (minter) => grants.get((minter ?? '').toLowerCase()) ?? [],
  })
  const openSeaRequests = await countAbortedRequests(
    browser,
    '**/api.opensea.io/**',
  )

  await openEligibilityWith(app, browser, {
    folders: [folder],
    wallets: [first, second],
    connections: [openseaConnection('deterministic-key')],
  })
  await checkScatterCollection(browser, screen, {
    slug: 'scatter-refresh',
    folder,
  })

  await expect(
    screen
      .getByRole('row')
      .filter({ hasText: first.address })
      .getByText('Eligible', { exact: true }),
  ).toHaveCount(2, { timeout: 60_000 })
  await screen.getByRole('button', { name: 'Save snapshot' }).click()

  await app.open('/mint/eligibility')
  await screen.getByRole('tab', { name: 'Snapshot' }).click()
  await expect(browser.locator('[data-snapshot-id]')).toHaveCount(1)
  await browser.locator('[data-snapshot-id]').click()

  await expect(screen.getByText('Scatter', { exact: true })).toBeVisible()
  await expect(
    screen.getByRole('columnheader', { name: 'Friends Discount' }),
  ).toBeVisible()
  await expect(
    screen
      .getByRole('row')
      .filter({ hasText: first.address })
      .getByText('Eligible', { exact: true }),
  ).toHaveCount(2)
  await expect(
    screen
      .getByRole('row')
      .filter({ hasText: second.address })
      .getByText('Not eligible', { exact: true }),
  ).toHaveCount(1)

  grants.set(second.address.toLowerCase(), ['friends'])
  await screen.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect(
    screen.getByRole('button', { name: 'Refresh snapshot' }),
  ).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })

  const refreshed = screen.getByRole('row').filter({ hasText: second.address })
  await expect(refreshed.getByText('Eligible', { exact: true })).toHaveCount(2)
  await expect(screen.getByRole('alert')).toHaveCount(0)
  await expect(screen.getByText('Scatter', { exact: true })).toBeVisible()

  // The refresh read a new Scatter answer rather than an OpenSea one.
  expect(openSeaRequests()).toBe(0)
  expect(calls.collections).toHaveLength(2)
  expect(calls.lists.filter((call) => call.minter === null)).toHaveLength(2)
  expect(calls.lists.filter((call) => call.minter !== null)).toHaveLength(4)
})

test('a Scatter collection on an unsignable chain refuses before any wallet read', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility Polygon')
  const [wallet] = pickWallets(1, folder.id)
  if (!wallet) throw new Error('one wallet required')

  const calls = await mockScatterNetwork({
    browser,
    slug: 'scatter-polygon',
    chainId: 137,
    lists: [{ id: 'public', name: 'Public' }],
  })

  await openEligibilityWith(app, browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
  })
  await checkScatterCollection(browser, screen, {
    slug: 'scatter-polygon',
    folder,
  })

  await expect(screen.getByText(/Polygon \(chain 137\)/)).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByText(/cannot sign for/)).toBeVisible()

  expect(calls.collections).toEqual(['scatter-polygon'])
  expect(calls.lists).toHaveLength(0)
})

test('a snapshot written before the source was recorded refreshes through OpenSea', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Eligibility Legacy')
  const [wallet] = pickWallets(1, folder.id)
  if (!wallet) throw new Error('one wallet required')

  const scatterRequests = await countAbortedRequests(
    browser,
    '**/api.scatter.art/**',
  )
  await guardOpenSeaHost(browser)
  const drops = await mockDrop(browser, {
    slug: SLUG,
    body: dropFixture({
      slug: SLUG,
      contract: CONTRACT,
      name: 'Legacy Drop',
      stages: [
        {
          uuid: STAGE_ID.replaceAll('-', ''),
          label: 'Public',
          maxPerWallet: '1',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-02T00:00:00.000Z',
        },
      ],
    }),
  })
  const collection = await mockCollection(browser, {
    slug: SLUG,
    body: {
      collection: SLUG,
      name: 'Legacy Drop',
      image_url: '',
      contracts: [{ address: CONTRACT, chain: 'robinhood' }],
      total_supply: 1,
    },
  })
  const eligibility = await mockEligibility(browser, {
    slug: SLUG,
    token: AUTH_TOKEN,
    body: {
      stages: [
        {
          stage_uuid: STAGE_ID,
          is_eligible: true,
          max_total_mintable_by_wallet: '1',
          price: '0',
        },
      ],
    },
  })
  const auth = await mockAuth(browser, { token: AUTH_TOKEN })

  await openEligibilityWith(app, browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('deterministic-key')],
    snapshots: [
      legacySnapshot({
        id: 'legacy-opensea',
        marketplace: 'OpenSea',
        name: 'OpenSea Legacy',
        createdAt: 1_760_000_000_000,
        wallet,
      }),
      legacySnapshot({
        id: 'legacy-scatter',
        marketplace: 'Scatter',
        name: 'Scatter Legacy',
        createdAt: 1_760_000_001_000,
        wallet,
      }),
    ],
  })
  await screen.getByRole('tab', { name: 'Snapshot' }).click()

  // Both records load with the label and the row they were written with.
  await expect(browser.locator('[data-snapshot-id]')).toHaveCount(2)
  await expect(screen.getByText('OpenSea', { exact: true })).toBeVisible()
  await expect(screen.getByText('Scatter', { exact: true })).toBeVisible()

  await browser.locator('[data-snapshot-id="legacy-opensea"]').click()
  await expect(screen.getByText(wallet.address)).toBeVisible()
  await expect(
    screen.getByRole('columnheader', { name: 'Public' }),
  ).toBeVisible()
  await screen.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect(
    screen.getByRole('button', { name: 'Refresh snapshot' }),
  ).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })

  expect(drops.count).toBe(1)
  expect(collection.count).toBe(1)
  expect(eligibility.count).toBe(1)
  expect(auth.nonce.count).toBe(1)
  expect(auth.token.count).toBe(1)
  expect(scatterRequests()).toBe(0)
  await expect(screen.getByRole('alert')).toHaveCount(0)

  // A reload clears the cached sign-in token, so the second refresh signs in again
  // and every OpenSea endpoint has answered twice.
  await app.open('/mint/eligibility')
  await screen.getByRole('tab', { name: 'Snapshot' }).click()
  await browser.locator('[data-snapshot-id="legacy-scatter"]').click()
  await expect(screen.getByText('Scatter', { exact: true })).toBeVisible()
  await screen.getByRole('button', { name: 'Refresh snapshot' }).click()
  await expect(
    screen.getByRole('button', { name: 'Refresh snapshot' }),
  ).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })

  expect(drops.count).toBe(2)
  expect(collection.count).toBe(2)
  expect(eligibility.count).toBe(2)
  expect(auth.nonce.count).toBe(2)
  expect(auth.token.count).toBe(2)
  expect(scatterRequests()).toBe(0)
  await expect(screen.getByRole('alert')).toHaveCount(0)
  // OpenSea answered, so the record's old Scatter label is corrected.
  await expect(screen.getByText('OpenSea', { exact: true })).toBeVisible()
})
