import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import {
  mintWallets,
  openseaConnection,
  robinhoodRpc,
  walletFolder,
} from '../../support/data'
import { MINT_TEST_RPC_URL } from '../../support/mint'
import { seedVelox } from '../../support/seed'

// The real Scatter read: the collection and its lists come from api.scatter.art,
// not from a route mock. Nothing signs, so the wallet is a throwaway and the chain
// connection is never read; Start is refused until the Scatter mint lands.
const URL_LABEL = 'Collection URL or slug (OpenSea / Scatter)'
const SLUG = process.env.E2E_SCATTER_SLUG ?? 'hoodimals'

test(`the live Scatter collection ${SLUG} loads its lists`, async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Scatter Live')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await browser.addInitScript(() => {
    try {
      window.localStorage.setItem('wallet-chain', 'robinhood')
    } catch {}
  })
  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [
      robinhoodRpc(MINT_TEST_RPC_URL),
      openseaConnection('deterministic-key'),
    ],
  })
  await app.open('/mint/tasks')

  // The `www.` host is the URL an operator copies out of a browser.
  await screen.getByLabel(URL_LABEL).fill(`https://www.scatter.art/c/${SLUG}`)
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
  await screen.getByRole('button', { name: 'Check' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 90_000,
  })

  // The picker names a list the real API answered with, not a placeholder.
  const stage = (await screen.getByLabel('Mint Stage').textContent()) ?? ''
  expect(stage).not.toBe('Check a collection first')
  expect(stage).not.toBe('Select a stage')

  // A sub-precision price must never print as a free mint, and an open-ended list
  // must never print the 2106 sentinel as a date.
  await expect(screen.getByText('0.0000 ETH')).toHaveCount(0)
  await expect(screen.getByText(/2106/)).toHaveCount(0)

  // The Scatter mint is not built yet, so the panel names the missing step.
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled()
  await expect(
    screen.getByText(/cannot build a Scatter mint transaction/),
  ).toBeVisible()
})
