import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { walletFolder, walletRow } from '../support/data'
import { mockRpc } from '../support/rpc'
import { seedVelox } from '../support/seed'
import { countVeloxRows } from '../support/db'

const PUBLIC_RPC = /ethereum-rpc\.publicnode\.com/
const ONE_ETH = '0xde0b6b3a7640000'

test('one address in two folders counts once in the page totals', async ({
  app,
  browser,
}) => {
  const privateKey = generatePrivateKey()
  const left = walletFolder('Shared Left')
  const right = walletFolder('Shared Right')
  const wallets = [
    walletRow({ label: 'shared-left', privateKey, folderId: left.id }),
    walletRow({ label: 'shared-right', privateKey, folderId: right.id }),
  ]

  // The default chain is Ethereum, and the seeded providers have no endpoint,
  // so the balances come from the public node.
  await mockRpc(browser, { url: PUBLIC_RPC, balance: ONE_ETH })
  await app.open('/wallet-profiles')
  await seedVelox(browser, { folders: [left, right], wallets })
  await app.open('/wallet-profiles')

  const totalWallets = browser.locator('dt:has-text("Total wallets") + dd')
  await expect(totalWallets).toHaveText('1')
  const totalBalance = browser.locator('dt:has-text("Total balance") + dd')
  await expect(totalBalance).toHaveText('1.0000 ETH')
})

test('importing a key already stored under a checksummed address skips it', async ({
  app,
  browser,
  screen,
}) => {
  const privateKey = generatePrivateKey()
  const folder = walletFolder('Duplicate Keys')
  const checksummed = privateKeyToAccount(privateKey).address
  const existing = walletRow({
    label: 'existing',
    privateKey,
    folderId: folder.id,
    // The seed carries the mixed-case form a restored backup can hold.
    address: `0x${checksummed.slice(2).toUpperCase()}`,
  })

  await mockRpc(browser, { url: PUBLIC_RPC, balance: ONE_ETH })
  await app.open('/wallet-profiles')
  await seedVelox(browser, { folders: [folder], wallets: [existing] })
  await app.open('/wallet-profiles')

  await screen.getByLabel('Import wallets').fill(`duplicate,${privateKey}`)
  await screen.getByRole('button', { name: 'Import', exact: true }).click()

  await expect(screen.getByText('1 already present')).toBeVisible()
  const rows = await browser.evaluate(countVeloxRows, 'wallets')
  expect(rows).toBe(1)
})
