import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { walletFolder } from '../support/data'
import {
  checkCollection,
  mockMintRpc,
  mockScatterNetwork,
  oneWallet,
  pinMintGas,
  seedMintPage,
} from '../support/mint'

const SLUG = 'arm-away-drop'
const CHAIN_ID = 4663

test('an armed mint fires after the operator leaves the mint page', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Arm Away')
  const wallet = oneWallet(folder)
  const startMs = Date.now() + 10_000

  await mockScatterNetwork({
    browser,
    slug: SLUG,
    chainId: CHAIN_ID,
    lists: [
      {
        id: 'public',
        name: 'Public',
        walletLimit: 1,
        startTime: new Date(startMs).toISOString(),
      },
    ],
    mint: {},
  })
  const rpc = await mockMintRpc({
    browser,
    wallets: [wallet],
    // The arm fires on chain time, which has to advance for the countdown to end.
    blockTime: () => Date.now(),
  })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://scatter.art/c/${SLUG}`
  )

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Public' }).click()
  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(screen.getByText('Mint opens in')).toBeVisible({
    timeout: 10_000,
  })

  // The arm belongs to the retained task store, so the fire must not depend on
  // this page staying mounted.
  await browser.locator('a[href="/portfolio"]').first().click()
  await expect(browser).toHaveURL('/portfolio')
  await expect
    .poll(
      () => rpc.events.filter((event) => event.kind === 'send').length,
      { timeout: 60_000 }
    )
    .toBe(1)

  await browser.locator('a[href="/mint/tasks"]').first().click()
  await expect(browser).toHaveURL('/mint/tasks')
  await expect(
    screen.getByRole('row').filter({ hasText: wallet.address })
  ).toContainText('Confirmed', { timeout: 30_000 })
})
