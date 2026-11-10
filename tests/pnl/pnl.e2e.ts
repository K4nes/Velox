import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { pnlRecordFixture } from '../support/fixtures/pnl'
import { seedVelox } from '../support/seed'

test('a seeded PnL record renders on monthly and lifetime', async ({
  app,
  browser,
  screen,
}) => {
  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    pnlRecords: [pnlRecordFixture({ name: 'Mock Collection' })],
  })

  await app.open('/pnl/monthly')
  const row = screen.getByRole('row').filter({ hasText: 'Mock Collection' })
  await expect(row).toContainText('1.0000 ETH')
  await expect(row).toContainText('$3,000.00')

  await app.open('/pnl/lifetime')
  const netTotal = browser.locator('dt:has-text("Net Total PnL") + dd')
  await expect(netTotal).toContainText('1.0000 ETH')
})
