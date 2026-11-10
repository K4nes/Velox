import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import {
  RH8_ADDRESS,
  RH8_FOLDER,
  openseaConnection,
  rh8Wallet,
  robinhoodRpc,
} from '../../support/data'
import { requireEnv } from '../../support/env'
import { seedVelox } from '../../support/seed'

const ready = Boolean(
  process.env.E2E_WALLET_RH8_KEY &&
    process.env.E2E_RH_RPC_URL &&
    process.env.E2E_OPEN_SEA_KEY,
)

test(
  'rh8 is eligible for the bigfatfish collection',
  {
    skip: ready
      ? false
      : 'set E2E_WALLET_RH8_KEY, E2E_RH_RPC_URL and E2E_OPEN_SEA_KEY',
  },
  async ({ app, browser, screen }) => {
    await browser.addInitScript(() => {
      try {
        window.localStorage.setItem('wallet-chain', 'robinhood')
      } catch {}
    })

    // Real connections only: the wallet key signs the SIWE sign-in, and the
    // stored OpenSea key authorises the drop and eligibility reads.
    await app.open('/mint/eligibility')
    await seedVelox(browser, {
      folders: [RH8_FOLDER],
      wallets: [rh8Wallet(requireEnv('E2E_WALLET_RH8_KEY'))],
      connections: [
        robinhoodRpc(requireEnv('E2E_RH_RPC_URL')),
        openseaConnection(requireEnv('E2E_OPEN_SEA_KEY')),
      ],
    })
    await app.open('/mint/eligibility')

    await screen
      .getByLabel('Collection URL or slug (OpenSea / Scatter)')
      .fill('https://opensea.io/collection/bigfatfish/overview')
    await screen.getByRole('button', { name: /Select wallets/ }).click()
    await screen
      .getByRole('checkbox', { name: `Select all in ${RH8_FOLDER.name}` })
      .click()
    await browser.keyboard.press('Escape')

    await expect(
      screen.getByRole('tab', { name: 'Check Eligible' }),
    ).toBeVisible()
    await screen.getByRole('button', { name: 'Check' }).click()

    const row = screen.getByRole('row').filter({ hasText: RH8_ADDRESS })
    await expect(row.getByText(RH8_ADDRESS, { exact: true })).toBeVisible({
      timeout: 120_000,
    })

    // The failure message carries the real row, so a different live status is
    // reported as it renders instead of being flattened into a timeout.
    const rowText = await row.textContent()
    expect(rowText, `actual rh8 row: ${rowText}`).toContain('Eligible')
  },
)
