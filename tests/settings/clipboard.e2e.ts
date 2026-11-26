import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { openseaConnection } from '../support/data'
import { seedVelox } from '../support/seed'

test('Copy on a key writes the full value to the clipboard', async ({
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
  await seedVelox(browser, {
    connections: [openseaConnection('copy-key-1234')],
  })
  await app.open('/settings')

  await screen.getByRole('button', { name: 'Copy Key 1' }).click()

  const text = await browser.evaluate(async () => {
    return navigator.clipboard.readText()
  })
  expect(text).toBe('copy-key-1234')
})
