import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, openseaConnection, walletFolder } from '../support/data'
import { dropFixture } from '../support/fixtures/drop'
import {
  guardOpenSeaHost,
  mockAuth,
  mockCollection,
  mockDrop,
  mockEligibility,
} from '../support/opensea'
import { seedVelox } from '../support/seed'

const SLUG = 'mock-drop'
const COLLECTION_URL = `https://opensea.io/collection/${SLUG}`
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const AUTH_TOKEN = 'e2e-eligibility-token'

// The drop reports an undashed id while eligibility reports the dashed form;
// the app matches the two after removing the dashes.
const STAGE_ID = '01234567-89ab-cdef-0123-456789abcdef'

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
