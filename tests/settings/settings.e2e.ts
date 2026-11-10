import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('a seeded provider persists a key', async ({ app, browser, screen }) => {
  // Provider marks load from Iconify; a failed image hides itself, so an empty
  // 200 keeps the request off the network.
  await browser.route('**/api.iconify.design/**', async (route) => {
    await route.fulfill({ status: 200, body: '' })
  })

  // Migration 5 seeds OpenSea, CoinMarketCap, Alchemy and Ankr on first open.
  await app.open('/settings')

  const openSea = screen.getByRole('button', { name: /OpenSea/ })
  await expect(openSea).toBeVisible()
  await expect(
    screen.getByRole('button', { name: /CoinMarketCap/ })
  ).toBeVisible()
  await expect(screen.getByRole('button', { name: /Alchemy/ })).toBeVisible()
  await expect(screen.getByRole('button', { name: /Ankr/ })).toBeVisible()
  await expect(openSea).toHaveAttribute('aria-current', 'true')

  await screen.getByRole('button', 'Add key').click()
  await screen.getByLabel('Key 1 value').fill('e2e-opensea-1234')
  await expect(screen.getByText('Unsaved')).toBeVisible()

  await screen.getByRole('button', 'Save').click()
  await expect(screen.getByText('Saved', { exact: true })).toBeVisible()
  await expect(openSea).toContainText('1 key · 1234')
})
