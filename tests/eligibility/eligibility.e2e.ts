import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Browser } from '@e2e-dev/web'
import { RH8_FOLDER, mintWallets, openseaConnection } from '../support/data'
import { mockAuth, mockCollection } from '../support/opensea'
import { seedVelox } from '../support/seed'

const SLUG = 'mock-drop'
const COLLECTION_URL = `https://opensea.io/collection/${SLUG}`
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const AUTH_TOKEN = 'e2e-eligibility-token'

// The drop reports an undashed id while eligibility reports the dashed form;
// the app matches the two after removing the dashes.
const STAGE_ID = '01234567-89ab-cdef-0123-456789abcdef'
const STAGE_UUID_UNDASHED = STAGE_ID.replaceAll('-', '')

type OpenSeaCounters = { drop: number; eligibility: number }

/**
 * Answers the two drop reads. It owns the whole OpenSea host, so a path this
 * test did not anticipate is aborted rather than sent to the network; the
 * collection route registered afterwards takes precedence over this one.
 */
async function mockDrop(browser: Browser): Promise<OpenSeaCounters> {
  const counters = { drop: 0, eligibility: 0 }

  await browser.route('**/api.opensea.io/**', async (route) => {
    const path = new URL(route.request.url).pathname

    if (path === `/api/v2/drops/${SLUG}`) {
      counters.drop += 1
      await route.fulfill({
        status: 200,
        json: {
          collection_slug: SLUG,
          collection_name: 'Mock Drop',
          chain: 'robinhood',
          contract_address: CONTRACT,
          drop_type: 'seadrop_v1_erc721',
          is_minting: true,
          max_supply: '100',
          total_supply: '1',
          active_stage: null,
          next_stage: null,
          stages: [
            {
              uuid: STAGE_UUID_UNDASHED,
              stage_type: 'public',
              label: 'Public',
              price: '0',
              max_per_wallet: '1',
              start_time: '2026-01-01T00:00:00.000Z',
              end_time: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
      })
      return
    }

    if (path === `/api/v2/drops/${SLUG}/eligibility`) {
      counters.eligibility += 1
      if (route.request.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
        await route.fulfill({ status: 401, json: { errors: ['unauthorized'] } })
        return
      }
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
      return
    }

    await route.abort()
  })

  return counters
}

test('an eligible wallet renders and saves a snapshot', async ({
  app,
  browser,
  screen,
}) => {
  const [wallet] = mintWallets(1)

  const drops = await mockDrop(browser)
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
  const auth = await mockAuth(browser, { token: AUTH_TOKEN })

  await app.open('/mint/eligibility')
  await seedVelox(browser, {
    folders: [RH8_FOLDER],
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
    .getByRole('checkbox', { name: `Select all in ${RH8_FOLDER.name}` })
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
  expect(drops.drop).toBe(1)
  expect(drops.eligibility).toBe(1)
  expect(auth.nonce.count).toBe(1)
  expect(auth.token.count).toBe(1)
})
