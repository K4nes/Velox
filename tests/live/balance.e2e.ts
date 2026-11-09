import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { requireEnv } from '../support/env'
import { RH8_FOLDER, rh8Wallet, robinhoodRpc } from '../support/data'
import { seedVelox } from '../support/seed'

const ready = Boolean(process.env.E2E_WALLET_RH8_KEY && process.env.E2E_RH_RPC_URL)

test(
  'rh8 shows its real Robinhood Chain balance',
  { skip: ready ? false : 'set E2E_WALLET_RH8_KEY and E2E_RH_RPC_URL' },
  async ({ app, browser, screen }) => {
    await browser.addInitScript(() => {
      try {
        window.localStorage.setItem('wallet-chain', 'robinhood')
      } catch {}
    })

    // The public fallback must never answer: a pass proves the seeded Alchemy
    // connection is the endpoint the app used.
    await browser.route('**rpc.mainnet.chain.robinhood.com/**', async () => {
      throw new Error('public Robinhood RPC used; the Alchemy connection was not picked')
    })

    await app.open('/wallet-profiles')
    await seedVelox(browser, {
      folders: [RH8_FOLDER],
      wallets: [rh8Wallet(requireEnv('E2E_WALLET_RH8_KEY'))],
      connections: [robinhoodRpc(requireEnv('E2E_RH_RPC_URL'))],
    })
    await app.open('/wallet-profiles')

    const row = screen.getByRole('row').filter({ hasText: 'rh8' })
    await expect(row).toContainText('0x74c8f5ab3649c280fb986fde3ee13da4dd1f5210')
    const balance = row.getByText(/^\d+\.\d{4} ETH$/)
    await expect(balance).toBeVisible({ timeout: 60_000 })
    await expect(balance).not.toHaveText('0.0000 ETH')
  },
)
