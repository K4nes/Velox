import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Browser, WebApp } from '@e2e-dev/web'
import type { Screen } from 'e2e'
import { walletFolder } from '../support/data'
import {
  checkCollection,
  mockMintRpc,
  mockScatterNetwork,
  oneWallet,
  seedMintPage,
} from '../support/mint'
import type { MintEvent } from '../support/mint'
import type { FolderRow, WalletRow } from '../support/seed'

const SLUG = 'chain-clock-drop'
const CHAIN_ID = 4663

const sendsOf = (events: MintEvent[]) =>
  events.filter((event) => event.kind === 'send')

async function seedClockTask(options: {
  app: WebApp
  browser: Browser
  screen: Screen
  folder: FolderRow
  wallet: WalletRow
  chainNow: number
  startTime: string
  endTime: string
}): Promise<MintEvent[]> {
  await mockScatterNetwork({
    browser: options.browser,
    slug: SLUG,
    chainId: CHAIN_ID,
    lists: [
      {
        id: 'public',
        name: 'Public',
        walletLimit: 1,
        startTime: options.startTime,
        endTime: options.endTime,
      },
    ],
    mint: {},
  })
  const rpc = await mockMintRpc({
    browser: options.browser,
    wallets: [options.wallet],
    nowMs: options.chainNow,
  })
  await seedMintPage(options.app, options.browser, options.folder, [
    options.wallet,
  ])
  await checkCollection(
    options.browser,
    options.screen,
    options.folder,
    `https://scatter.art/c/${SLUG}`
  )
  return rpc.events
}

test('a stage the chain has closed disables Start while the desktop clock is still open', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Chain Closed')
  const wallet = oneWallet(folder)
  const now = Date.now()
  await seedClockTask({
    app,
    browser,
    screen,
    folder,
    wallet,
    // Two minutes ahead: the list closed on chain 90 seconds ago, but the
    // desktop clock still shows it open for another 30.
    chainNow: now + 120_000,
    startTime: new Date(now - 60_000).toISOString(),
    endTime: new Date(now + 30_000).toISOString(),
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Eligible', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await expect(screen.getByRole('button', { name: 'Start Mint' })).toBeDisabled({
    timeout: 30_000,
  })
})

test('a stage that has not opened on chain arms instead of minting on a fast desktop clock', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint Chain Future')
  const wallet = oneWallet(folder)
  const now = Date.now()
  const rpc = await seedClockTask({
    app,
    browser,
    screen,
    folder,
    wallet,
    // One minute behind: the list opened 30 seconds ago by the desktop clock,
    // but the chain has not reached its start yet.
    chainNow: now - 60_000,
    startTime: new Date(now - 30_000).toISOString(),
    endTime: new Date(now + 3_600_000).toISOString(),
  })

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(screen.getByText('Mint opens in')).toBeVisible({
    timeout: 10_000,
  })
  expect(sendsOf(rpc)).toHaveLength(0)
})
