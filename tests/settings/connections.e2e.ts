import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { customRpc } from '../support/data'
import { seedVelox } from '../support/seed'

const BACKUP_DIR = '.e2e/backups'
const RPC_URL = 'http://127.0.0.1:8545'

test('a provider restored by an import can be edited and saved', async ({
  app,
  browser,
  screen,
}) => {
  // Provider marks load from Iconify; a failed image hides itself, so an empty
  // 200 keeps the request off the network.
  await browser.route('**/api.iconify.design/**', async (route) => {
    await route.fulfill({ status: 200, body: '' })
  })

  const provider = customRpc('robinhood', RPC_URL)
  const providerRow = () =>
    screen.getByRole('button', { name: new RegExp(`^${provider.name}`) })

  await app.open('/settings')
  await seedVelox(browser, { connections: [provider] })
  await app.open('/settings')

  await providerRow().click()
  await screen
    .getByRole('button', { name: `Remove ${provider.name}` })
    .click()
  await screen.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(providerRow()).toBeHidden()

  // The import restores the row the page just deleted, so the page's delete
  // tombstone has to clear when the loader sees it again.
  await mkdir(BACKUP_DIR, { recursive: true })
  const file = join(BACKUP_DIR, 'restored-provider.json')
  await writeFile(
    file,
    JSON.stringify({
      app: 'velox',
      version: 1,
      exportedAt: Date.now(),
      folders: [],
      wallets: [],
      connections: [provider],
      pnlRecords: [],
    }),
    'utf8'
  )
  await browser.locator('input[type=file]').setInputFiles(file)
  await screen.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(providerRow()).toBeVisible()

  await providerRow().click()
  await screen.getByLabel('Provider name').fill('Restored Provider')
  await screen.getByRole('button', { name: 'Save' }).click()
  await expect(screen.getByText('Saved', { exact: true })).toBeVisible()

  // The row is only proven to persist once the page reads it back.
  await app.open('/settings')
  await expect(
    screen.getByRole('button', { name: /^Restored Provider/ })
  ).toBeVisible()
})
