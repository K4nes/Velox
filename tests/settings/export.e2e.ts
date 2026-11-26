import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('Export reports the download it started', async ({ app, browser, screen }) => {
  // Provider marks load from Iconify; a failed image hides itself, so an empty
  // 200 keeps the request off the network.
  await browser.route('**/api.iconify.design/**', async (route) => {
    await route.fulfill({ status: 200, body: '' })
  })

  await app.open('/settings')

  const download = await browser.waitForDownload(() =>
    screen.getByRole('button', { name: 'Export' }).click()
  )
  expect(download.suggestedFilename).toMatch(
    /^velox-backup-\d{4}-\d{2}-\d{2}\.json$/
  )
  await expect(
    screen.getByText(/^Backup download started: velox-backup-/)
  ).toBeVisible()
})
