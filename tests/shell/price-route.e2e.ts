import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { coinmarketcapConnection } from '../support/data'
import { mockPrice } from '../support/price'
import { seedVelox } from '../support/seed'

test('the PnL card reads the ETH/USDT quote from the exact price path', async ({
  app,
  browser,
  screen,
}) => {
  const price = await mockPrice(browser, { price: 2_000 })

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    connections: [coinmarketcapConnection('deterministic-key')],
  })
  await app.open('/pnl/card')

  await expect(screen.getByText('ETH/USDT $2,000.00')).toBeVisible()
  expect(price.paths).toEqual(['/api/price/eth-usdt'])
})
