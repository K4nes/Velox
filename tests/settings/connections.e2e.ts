import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('settings offers only the built-in RPC providers', async ({
  app,
  browser,
  screen,
}) => {
  // Provider marks load from Iconify; a failed image hides itself, so an empty
  // 200 keeps the request off the network.
  await browser.route('**/api.iconify.design/**', async (route) => {
    await route.fulfill({ status: 200, body: '' })
  })

  await app.open('/settings')

  await expect(screen.getByRole('button', { name: /Alchemy/ })).toBeVisible()
  await expect(screen.getByRole('button', { name: /Ankr/ })).toBeVisible()
  // The custom-provider popover and the editable name field are gone; adding a
  // chain only means adding one of the provider's own endpoints.
  await expect(
    screen.getByRole('button', { name: 'Add provider' })
  ).toHaveCount(0)
  await expect(screen.getByLabel('Provider name')).toHaveCount(0)
})
