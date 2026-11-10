import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { liveWallet, openseaConnection } from '../../support/data'
import { requireEnv } from '../../support/env'
import { scanCollection } from '../../support/scan'
import { seedVelox } from '../../support/seed'

const slug = process.env.E2E_PORTFOLIO_SLUG ?? ''
const privateKey = process.env.E2E_WALLET_KEY ?? ''
const label = process.env.E2E_WALLET_LABEL ?? ''
const folderName = process.env.E2E_WALLET_FOLDER ?? ''
const chain = process.env.E2E_PORTFOLIO_CHAIN ?? ''
const apiUrl = process.env.E2E_OPENSEA_API_URL ?? ''

const ready = Boolean(
  slug &&
    privateKey &&
    label &&
    folderName &&
    chain &&
    apiUrl &&
    process.env.E2E_OPEN_SEA_KEY,
)

async function readCollection(): Promise<{ name: string; chain: string }> {
  const baseUrl = apiUrl.replace(/\/$/, '')
  const response = await fetch(
    `${baseUrl}/api/v2/collections/${encodeURIComponent(slug)}`,
    { headers: { 'x-api-key': requireEnv('E2E_OPEN_SEA_KEY') } },
  )
  expect(response.status, 'the collection lookup').toBe(200)
  const body = (await response.json()) as {
    name?: string
    contracts?: { chain?: string }[]
  }
  return {
    name: body.name ?? '',
    chain: body.contracts?.[0]?.chain ?? '',
  }
}

test(
  'the configured wallet scans the collection into the portfolio',
  {
    skip: ready
      ? false
      : 'set E2E_PORTFOLIO_SLUG, E2E_WALLET_KEY, E2E_WALLET_LABEL, E2E_WALLET_FOLDER, E2E_PORTFOLIO_CHAIN, E2E_OPENSEA_API_URL and E2E_OPEN_SEA_KEY',
  },
  async ({ app, browser, screen }) => {
    const { folder, wallet } = liveWallet({
      privateKey,
      label,
      folder: folderName,
    })
    const collection = await readCollection()
    test.skip(
      collection.chain !== chain,
      `portfolio scan needs a ${chain} collection; ${collection.name} is on ${collection.chain}`,
    )

    await app.open('/portfolio')
    await seedVelox(browser, {
      folders: [folder],
      wallets: [wallet],
      connections: [openseaConnection(requireEnv('E2E_OPEN_SEA_KEY'))],
    })
    await app.open('/portfolio')

    await scanCollection({
      browser,
      screen,
      feature: 'portfolio',
      collection: slug,
      folder: folder.name,
    })

    const row = screen.getByRole('row').filter({ hasText: collection.name })
    await expect(row).toBeVisible({ timeout: 180_000 })
    const totalOwned = browser.locator(
      'xpath=//dt[normalize-space(.)="Total owned"]/following-sibling::dd/span[1]',
    )
    await expect(totalOwned).toHaveText(/^[1-9]\d*$/, { timeout: 180_000 })
    await expect(screen.getByText(/could not be ranked/)).toHaveCount(0)
  },
)
