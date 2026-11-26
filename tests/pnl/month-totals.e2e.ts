import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { pnlRecordFixture } from '../support/fixtures/pnl'
import { seedVelox } from '../support/seed'

test('monthly reports a mixed-baseline change; lifetime withholds a one-month ranking', async ({
  app,
  browser,
  screen,
}) => {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const firstAt = new Date(now.getFullYear(), now.getMonth(), 1, 9).getTime()
  const secondAt = new Date(now.getFullYear(), now.getMonth(), 2, 9).getTime()
  const contract = `0x${'d1'.repeat(20)}`
  const walletA = `0x${'a1'.repeat(20)}`
  const walletB = `0x${'b2'.repeat(20)}`
  const walletC = `0x${'c3'.repeat(20)}`

  const records = [
    pnlRecordFixture({
      contract,
      name: 'Mixed Baseline',
      day: `${month}-01`,
      createdAt: firstAt,
      wallets: [walletA, walletB],
      netPnl: '15000000000000000000',
    }),
    pnlRecordFixture({
      contract,
      name: 'Mixed Baseline',
      day: `${month}-02`,
      createdAt: secondAt,
      wallets: [walletA, walletC],
      netPnl: '12000000000000000000',
    }),
  ]

  await app.open('/pnl/monthly')
  await seedVelox(browser, { pnlRecords: records })
  await app.open('/pnl/monthly')

  // Day 1 measures 15 ETH and day 2 measures 12 starting from its own baseline,
  // so the month is 27 under the shared delta rule. The chart accumulates the
  // two days, and the lifetime page cannot rank a mixed-baseline month.
  await expect(browser.locator('span:text-is("Month net") + span')).toContainText(
    '27.0000 ETH',
  )
  await expect(
    screen.getByText(
      'Wallet selection changed between checks; this month mixes baselines.',
    ),
  ).toBeVisible()

  await app.open('/pnl/lifetime')

  const best = browser.locator(
    'xpath=//span[normalize-space()="Best month"]/../following-sibling::span[1]',
  )
  await expect(best).toContainText('—')
  await expect(
    screen.getByText('Mixed baselines').first()
  ).toBeVisible()
  await expect(
    screen.getByText(
      'Wallet selection changed between checks; those months mix baselines.',
    ),
  ).toBeVisible()
})

test('a month holding only a partial check does not claim a zero net', async ({
  app,
  browser,
  screen,
}) => {
  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    pnlRecords: [pnlRecordFixture({ truncated: true })],
  })
  await app.open('/pnl/monthly')

  const monthNet = browser.locator('span:text-is("Month net") + span')
  await expect(monthNet).toContainText('partial read')
  await expect(monthNet).not.toContainText('0.0000 ETH')
  await expect(screen.getByText('No complete checks this month.')).toBeVisible()
})

test('a cross-month wallet change hides the lifetime chart and ranking', async ({
  app,
  browser,
  screen,
}) => {
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 9)
  const current = new Date(now.getFullYear(), now.getMonth(), 1, 9)
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
  const contract = `0x${'e2'.repeat(20)}`
  const walletA = `0x${'a1'.repeat(20)}`
  const walletB = `0x${'b2'.repeat(20)}`

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    pnlRecords: [
      pnlRecordFixture({
        contract,
        name: 'Cross Month',
        day: day(prev),
        createdAt: prev.getTime(),
        wallets: [walletA, walletB],
        netPnl: '15000000000000000000',
      }),
      pnlRecordFixture({
        contract,
        name: 'Cross Month',
        day: day(current),
        createdAt: current.getTime(),
        wallets: [walletA],
        netPnl: '6000000000000000000',
      }),
    ],
  })
  await app.open('/pnl/monthly')

  // The narrowed month is a new baseline, not a 6 ETH change from January.
  await expect(
    browser.locator('span:text-is("Month net") + span')
  ).toContainText('6.0000 ETH')
  await expect(
    screen.getByText(
      'Wallet selection changed between checks; this month mixes baselines.',
    ),
  ).toBeVisible()

  await app.open('/pnl/lifetime')

  await expect(screen.getByText('Latest Net PnL')).toBeVisible()
  await expect(
    screen.getByText(
      'Wallet selection changed between months; those months are not ranked and the cumulative chart is hidden.',
    ),
  ).toBeVisible()
  await expect(
    screen.getByText('Only one comparable month').first(),
  ).toBeVisible()
  await expect(
    browser.locator(
      'xpath=//span[normalize-space()="Average / month"]/../following-sibling::span[1]',
    ),
  ).toContainText('15.0000 ETH')
})

test('widening a wallet set keeps the lifetime chart and both months ranked', async ({
  app,
  browser,
  screen,
}) => {
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 9)
  const current = new Date(now.getFullYear(), now.getMonth(), 1, 9)
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
  const contract = `0x${'e3'.repeat(20)}`
  const walletA = `0x${'a1'.repeat(20)}`
  const walletB = `0x${'b2'.repeat(20)}`

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    pnlRecords: [
      pnlRecordFixture({
        contract,
        name: 'Widening',
        day: day(prev),
        createdAt: prev.getTime(),
        wallets: [walletA],
        netPnl: '5000000000000000000',
      }),
      pnlRecordFixture({
        contract,
        name: 'Widening',
        day: day(current),
        createdAt: current.getTime(),
        wallets: [walletA, walletB],
        netPnl: '15000000000000000000',
      }),
    ],
  })
  await app.open('/pnl/monthly')

  // The added wallet's 10 ETH is a real change from the 5 ETH baseline.
  await expect(
    browser.locator('span:text-is("Month net") + span'),
  ).toContainText('10.0000 ETH')
  await expect(
    screen.getByText(
      'Wallet selection changed between checks; this month mixes baselines.',
    ),
  ).toHaveCount(0)

  await app.open('/pnl/lifetime')

  await expect(screen.getByText('Latest Net PnL')).toBeVisible()
  await expect(
    screen.getByText(
      'Wallet selection changed between months; those months are not ranked and the cumulative chart is hidden.',
    ),
  ).toHaveCount(0)
  await expect(screen.getByText('Cumulative performance')).toBeVisible()

  const best = browser.locator(
    'xpath=//span[normalize-space()="Best month"]/../following-sibling::span[1]',
  )
  const worst = browser.locator(
    'xpath=//span[normalize-space()="Worst month"]/../following-sibling::span[1]',
  )
  const average = browser.locator(
    'xpath=//span[normalize-space()="Average / month"]/../following-sibling::span[1]',
  )
  await expect(best).toContainText('10.0000 ETH')
  await expect(worst).toContainText('5.0000 ETH')
  await expect(average).toContainText('7.5000 ETH')
})

test('widening a wallet set within one month is not flagged as mixed baselines', async ({
  app,
  browser,
  screen,
}) => {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 9)
  const second = new Date(now.getFullYear(), now.getMonth(), 5, 9)
  const contract = `0x${'e4'.repeat(20)}`
  const walletA = `0x${'a1'.repeat(20)}`
  const walletB = `0x${'b2'.repeat(20)}`

  await app.open('/pnl/monthly')
  await seedVelox(browser, {
    pnlRecords: [
      pnlRecordFixture({
        contract,
        name: 'Same Month Widening',
        day: `${month}-01`,
        createdAt: first.getTime(),
        wallets: [walletA],
        netPnl: '5000000000000000000',
      }),
      pnlRecordFixture({
        contract,
        name: 'Same Month Widening',
        day: `${month}-05`,
        createdAt: second.getTime(),
        wallets: [walletA, walletB],
        netPnl: '15000000000000000000',
      }),
    ],
  })
  await app.open('/pnl/monthly')

  // The added wallet's 10 ETH is a change from the 5 ETH covered baseline.
  await expect(
    browser.locator('span:text-is("Month net") + span'),
  ).toContainText('15.0000 ETH')
  await expect(
    screen.getByText(
      'Wallet selection changed between checks; this month mixes baselines.',
    ),
  ).toHaveCount(0)

  await app.open('/pnl/lifetime')
  await expect(screen.getByText('Cumulative performance')).toBeVisible()
  await expect(
    screen.getByText(
      'Wallet selection changed between months; those months are not ranked and the cumulative chart is hidden.',
    ),
  ).toHaveCount(0)
})
