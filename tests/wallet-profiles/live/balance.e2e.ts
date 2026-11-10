import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { requireEnv } from '../../support/env'
import { liveWallet, robinhoodRpc } from '../../support/data'
import { seedVelox } from '../../support/seed'

const ready = Boolean(
  process.env.E2E_WALLET_KEY &&
    process.env.E2E_WALLET_LABEL &&
    process.env.E2E_WALLET_FOLDER &&
    process.env.E2E_RH_RPC_URL,
)

test(
  'the configured wallet shows its real Robinhood Chain balance',
  {
    skip: ready
      ? false
      : 'set E2E_WALLET_KEY, E2E_WALLET_LABEL, E2E_WALLET_FOLDER and E2E_RH_RPC_URL',
  },
  async ({ app, browser, screen }) => {
    const { folder, wallet } = liveWallet({
      privateKey: requireEnv('E2E_WALLET_KEY'),
      label: requireEnv('E2E_WALLET_LABEL'),
      folder: requireEnv('E2E_WALLET_FOLDER'),
    })
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
      folders: [folder],
      wallets: [wallet],
      connections: [robinhoodRpc(requireEnv('E2E_RH_RPC_URL'))],
    })
    await app.open('/wallet-profiles')

    const row = screen.getByRole('row').filter({ hasText: wallet.label })
    await expect(row).toContainText(wallet.address)
    const balance = row.getByText(/^\d+\.\d{4} ETH$/)
    await expect(balance).toBeVisible({ timeout: 60_000 })
    await expect(balance).not.toHaveText('0.0000 ETH')
  },
)
