import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { JsonValue } from 'e2e'
import {
  coinmarketcapConnection,
  liveWallet,
  openseaConnection,
} from '../../support/data'
import { requireEnv } from '../../support/env'
import { seedVelox } from '../../support/seed'

const ETH_FIGURE = /^-?\d+\.\d{4}(?: ETH)?$/

// The collection and the wallet both come from the ignored env file; nothing
// about this run is imported from a fixture.
const slug = process.env.E2E_PNL_SLUG ?? ''
const privateKey = process.env.E2E_WALLET_RH8_KEY ?? ''
const label = process.env.E2E_WALLET_LABEL ?? ''
const folderName = process.env.E2E_WALLET_FOLDER ?? ''
const chain = process.env.E2E_PNL_CHAIN ?? ''
const apiUrl = process.env.E2E_OPENSEA_API_URL ?? ''

/** Without a key the server's own quote decides; the card then shows a dash. */
const cmcKey = process.env.E2E_CMC_KEY ?? ''

const ready = Boolean(
  slug &&
    privateKey &&
    label &&
    folderName &&
    chain &&
    apiUrl &&
    process.env.E2E_OPEN_SEA_KEY,
)

/** The fields of the stored `pnl-records` row this scenario reads. */
type StoredRecord = {
  contract: string
  wallets: string[]
  netPnl: string
  truncated: boolean
  unpriced: boolean
  ethPriceUsd: number | null
  breakdown?: {
    v: number
    realized: string
    spent: string
    basis: string
    held: number
    sold: number
  }
}

function isStoredRecord(value: unknown): value is StoredRecord {
  if (typeof value !== 'object' || value === null) return false
  return (
    'contract' in value &&
    typeof value.contract === 'string' &&
    'wallets' in value &&
    Array.isArray(value.wallets) &&
    'breakdown' in value
  )
}

/**
 * The name, chain and contract the card will resolve, read over the public API
 * first so the test knows what the UI has to show.
 */
async function readCollection(): Promise<{
  name: string
  chain: string
  contract: string
}> {
  const baseUrl = apiUrl.replace(/\/$/, '')
  const response = await fetch(
    `${baseUrl}/api/v2/collections/${encodeURIComponent(slug)}`,
    { headers: { 'x-api-key': requireEnv('E2E_OPEN_SEA_KEY') } },
  )
  expect(response.status, 'the collection lookup').toBe(200)
  const body = (await response.json()) as {
    name?: string
    contracts?: { address?: string; chain?: string }[]
  }
  return {
    name: body.name ?? '',
    chain: body.contracts?.[0]?.chain ?? '',
    contract: body.contracts?.[0]?.address ?? '',
  }
}

test(
  'the seeded wallet reads the collection PnL and the monthly row matches the card',
  {
    skip: ready
      ? false
      : 'set E2E_PNL_SLUG, E2E_WALLET_RH8_KEY, E2E_WALLET_LABEL, E2E_WALLET_FOLDER, E2E_PNL_CHAIN, E2E_OPENSEA_API_URL and E2E_OPEN_SEA_KEY',
  },
  async ({ app, browser, screen }) => {
    const { folder, wallet } = liveWallet({
      privateKey,
      label,
      folder: folderName,
    })
    const collection = await readCollection()
    // The card refuses a chain without an explorer API before it reads.
    test.skip(
      collection.chain !== chain,
      `PnL needs an explorer API; ${collection.name} is on ${collection.chain}`,
    )

    await app.open('/pnl/card')
    await seedVelox(browser, {
      folders: [folder],
      wallets: [wallet],
      connections: [
        openseaConnection(requireEnv('E2E_OPEN_SEA_KEY')),
        ...(cmcKey === '' ? [] : [coinmarketcapConnection(cmcKey)]),
      ],
    })
    await app.open('/pnl/card')

    await screen
      .getByLabel('Collection URL or slug (OpenSea / Scatter)')
      .fill(slug)
    await screen.getByRole('button', { name: /Select wallets/ }).click()
    await screen
      .getByRole('checkbox', { name: `Select all in ${folder.name}` })
      .click()
    await browser.keyboard.press('Escape')
    await screen.getByRole('button', { name: 'Check PnL' }).click()

    const total = browser.locator('span:text-is("Total PnL") + span')
    const totalUsd = browser.locator('span:text-is("Total PnL") + span + span')
    const stat = (field: string) =>
      browser.locator(`span:text-is("${field}") + span`)

    // The card keeps the dash until the chain read lands, so a number here is
    // the read. A failure is reported with the toasts the card raised.
    let failure = ''
    try {
      await expect(total).not.toHaveText('—', { timeout: 180_000 })
    } catch {
      const toasts = await browser
        .locator('[data-sonner-toast]')
        .allTextContents()
      failure = toasts.join(' | ')
    }
    expect(
      failure,
      `the live read produced no numbers; the card toasted: ${failure}`,
    ).toBe('')

    const values = {
      realized: (await stat('Realized').textContent()) ?? '',
      unrealized: (await stat('Unrealized').textContent()) ?? '',
      invested: (await stat('Invested').textContent()) ?? '',
      current: (await stat('Current value').textContent()) ?? '',
      total: (await total.textContent()) ?? '',
      usd: (await totalUsd.textContent()) ?? '',
    }
    console.log(`PnL ${slug} for ${label}: ${JSON.stringify(values)}`)

    for (const [label, value] of Object.entries(values)) {
      if (label === 'usd') continue
      expect(value, `${label} is not an ETH figure`).toMatch(ETH_FIGURE)
    }
    // The key is seeded, so a dash here means the price route refused it.
    if (cmcKey !== '') {
      expect(values.usd, 'the card has no USD figure').toMatch(
        /^\$[\d,]+\.\d{2}$/,
      )
    }

    // The check writes the day's record, so the monthly table has to carry the
    // same total the card shows.
    await app.open('/pnl/monthly')
    const row = screen.getByRole('row').filter({ hasText: collection.name })
    await expect(row).toBeVisible({ timeout: 60_000 })
    // The card's total carries its unit; the monthly cell formats the same wei
    // with the same digits, so the two texts have to be identical.
    await expect(row).toContainText(values.total)
    // A cut or unpriced read is labelled, and its row stays out of the totals.
    await expect(row).not.toContainText('partial read')
    if (cmcKey !== '') {
      await expect(row).toContainText('$')
    }

    // The row the check wrote: the counts and the split the card cannot show.
    const read = await browser.evaluate(async (): Promise<{
      rows: JsonValue[]
    }> => {
      const opened = Promise.withResolvers<IDBDatabase>()
      const request = indexedDB.open('velox')
      request.onsuccess = () => opened.resolve(request.result)
      request.onerror = () => opened.reject(request.error)
      const db = await opened.promise
      try {
        const rows = Promise.withResolvers<JsonValue[]>()
        const all = db.transaction('pnl-records', 'readonly').objectStore(
          'pnl-records',
        ).getAll()
        all.onsuccess = () => rows.resolve(all.result as JsonValue[])
        all.onerror = () => rows.reject(all.error)
        return { rows: await rows.promise }
      } finally {
        db.close()
      }
    })

    const stored = read.rows.find(
      (entry): entry is StoredRecord =>
        isStoredRecord(entry) &&
        entry.contract.toLowerCase() === collection.contract.toLowerCase(),
    )
    console.log(`PnL record for ${slug}: ${JSON.stringify(stored)}`)

    expect(stored, 'the monthly row has no stored record').toBeDefined()
    if (stored === undefined) return
    expect(stored.wallets).toEqual([wallet.address.toLowerCase()])
    expect(stored.truncated, 'the read covered only the newest transfers').toBe(
      false,
    )
    expect(stored.unpriced, 'some trades were left out').toBe(false)
    expect(stored.breakdown?.v, 'the row carries the v2 split').toBe(2)
    if (cmcKey !== '') {
      expect(stored.ethPriceUsd, 'the row has no USD quote').not.toBeNull()
    }
  },
)
