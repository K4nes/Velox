import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('root redirects to the mint tasks page', async ({ app, browser, screen }) => {
  await app.open('/')
  await expect(browser).toHaveURL('/mint/tasks')
  await expect(browser.locator('header')).toContainText('Tasks')
  await expect(screen.getByText('Mint Configuration')).toBeVisible()
})

test('an unknown path renders the not found title', async ({ app, browser, screen }) => {
  await app.open('/no-such-page')
  await expect(browser.locator('header')).toContainText('Not found')
  await expect(screen.getByRole('link', 'Go to Tasks')).toBeVisible()
})
