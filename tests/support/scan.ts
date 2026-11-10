import type { Browser } from '@e2e-dev/web'
import type { Screen } from 'e2e'

/** The held-token pages that share the collection form. */
export type ScanFeature = 'portfolio' | 'bulk-sell' | 'instant-sell' | 'transfer'

const SCAN_BUTTON: Record<ScanFeature, string> = {
  portfolio: 'Scan portfolio',
  'bulk-sell': 'Scan held NFTs',
  'instant-sell': 'Scan held NFTs',
  transfer: 'Rescan',
}

/**
 * Runs the collection form every held-token page shares: fill the OpenSea
 * slug, select the seeded folder in the wallet picker, close the picker, then
 * scan. The picker's group row is collapsed, so the group checkbox is the way
 * in, and the picker closes on Escape.
 */
export async function scanCollection(options: {
  browser: Browser
  screen: Screen
  feature: ScanFeature
  collection: string
  folder?: string
}): Promise<void> {
  const { browser, screen, feature, collection, folder = 'Robinhood' } = options

  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill(`https://opensea.io/collection/${collection}`)

  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen.getByRole('checkbox', { name: `Select all in ${folder}` }).click()
  await browser.keyboard.press('Escape')

  await screen.getByRole('button', SCAN_BUTTON[feature]).click()
}
