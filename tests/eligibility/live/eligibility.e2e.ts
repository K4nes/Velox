import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { privateKeyToAccount } from 'viem/accounts'
import { openseaConnection, robinhoodRpc } from '../../support/data'
import { requireEnv } from '../../support/env'
import { seedVelox } from '../../support/seed'
import type { FolderRow, WalletRow } from '../../support/seed'

const COLLECTION_URL = process.env.E2E_ELIGIBILITY_COLLECTION_URL
const EXPECTED_STATUS = process.env.E2E_ELIGIBILITY_EXPECT
const WALLET_KEY =
  process.env.E2E_ELIGIBILITY_WALLET_KEY ?? process.env.E2E_WALLET_RH8_KEY
const OPEN_SEA_KEY = process.env.E2E_OPEN_SEA_KEY
const RPC_URL = process.env.E2E_RH_RPC_URL

const ready = Boolean(
  COLLECTION_URL && EXPECTED_STATUS && WALLET_KEY && OPEN_SEA_KEY && RPC_URL,
)

const FOLDER: FolderRow = {
  id: 'folder-eligibility-live',
  name: 'Eligibility',
  createdAt: 1_760_000_000_000,
}

function asHexKey(privateKey: string): `0x${string}` {
  return `0x${privateKey.trim().replace(/^0x/i, '')}` as `0x${string}`
}

test(
  'the configured wallet shows the configured eligibility status',
  {
    skip: ready
      ? false
      : 'set E2E_ELIGIBILITY_COLLECTION_URL, E2E_ELIGIBILITY_EXPECT, E2E_ELIGIBILITY_WALLET_KEY (or E2E_WALLET_RH8_KEY), E2E_OPEN_SEA_KEY and E2E_RH_RPC_URL',
  },
  async ({ app, browser, screen }) => {
    const collectionUrl = requireEnv('E2E_ELIGIBILITY_COLLECTION_URL')
    const expected = requireEnv('E2E_ELIGIBILITY_EXPECT')
    const privateKey =
      process.env.E2E_ELIGIBILITY_WALLET_KEY ?? requireEnv('E2E_WALLET_RH8_KEY')
    const account = privateKeyToAccount(asHexKey(privateKey))
    const wallet: WalletRow = {
      id: 'wallet-eligibility-live',
      folderId: FOLDER.id,
      label: 'eligibility',
      address: account.address,
      privateKey,
      createdAt: FOLDER.createdAt,
    }

    await browser.addInitScript(() => {
      try {
        window.localStorage.setItem('wallet-chain', 'robinhood')
      } catch {}
    })

    // Real connections only: the wallet key signs the SIWE sign-in, and the
    // stored OpenSea key authorises the drop and eligibility reads.
    await app.open('/mint/eligibility')
    await seedVelox(browser, {
      folders: [FOLDER],
      wallets: [wallet],
      connections: [
        robinhoodRpc(requireEnv('E2E_RH_RPC_URL')),
        openseaConnection(requireEnv('E2E_OPEN_SEA_KEY')),
      ],
    })
    await app.open('/mint/eligibility')

    await screen
      .getByLabel('Collection URL or slug (OpenSea / Scatter)')
      .fill(collectionUrl)
    await screen.getByRole('button', { name: /Select wallets/ }).click()
    await screen
      .getByRole('checkbox', { name: `Select all in ${FOLDER.name}` })
      .click()
    await browser.keyboard.press('Escape')

    await expect(
      screen.getByRole('tab', { name: 'Check Eligible' }),
    ).toBeVisible()
    await screen.getByRole('button', { name: 'Check' }).click()

    const row = screen.getByRole('row').filter({ hasText: wallet.address })
    await expect(row.getByText(wallet.address, { exact: true })).toBeVisible({
      timeout: 120_000,
    })

    // The failure message carries the real row, so a different live status is
    // reported as it renders instead of being flattened into a timeout.
    const rowText = await row.textContent()
    expect(rowText, `actual row for ${wallet.address}: ${rowText}`).toContain(
      expected,
    )
  },
)
