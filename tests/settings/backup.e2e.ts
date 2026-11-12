import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { generatePrivateKey } from 'viem/accounts'
import { recoverTransactionAddress } from 'viem'
import {
  mintWallets,
  openseaConnection,
  robinhoodRpc,
  walletFolder,
  walletRow,
} from '../support/data'
import { collectionFixture } from '../support/fixtures/collection'
import { holdingsFixture } from '../support/fixtures/holdings'
import { pnlRecordFixture } from '../support/fixtures/pnl'
import { mockCollection, mockHoldings } from '../support/opensea'
import { mockRpc, word } from '../support/rpc'
import { scanCollection } from '../support/scan'
import { seedVelox } from '../support/seed'
import { clearVeloxStores, countVeloxRows } from '../support/db'

type Page = Parameters<typeof seedVelox>[0]

const BACKUP_DIR = '.e2e/backups'
const SLUG = 'restored-drop'
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const TOKEN_ID = '1'
const RPC_URL = 'http://127.0.0.1:8545'
const DESTINATION = '0x0000000000000000000000000000000000000001'
const SUPPORTS_INTERFACE = '0x01ffc9a7'

test('export writes one JSON document and a fresh store restores it', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Export Check')
  const wallet = walletRow({
    label: 'exporter',
    privateKey: generatePrivateKey(),
    folderId: folder.id,
  })
  const record = pnlRecordFixture({ name: 'Mock Collection' })

  // A restored profile holds no endpoint yet, so the balance reads fall back to
  // the public node and must not reach the network.
  await mockRpc(browser, { url: 'https://ethereum-rpc.publicnode.com' })

  await app.open('/settings')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [openseaConnection('backup-key-1234')],
    pnlRecords: [record],
  })
  await app.open('/settings')

  const download = await browser.waitForDownload(() =>
    screen.getByRole('button', 'Export').click(),
  )
  const text = await readFile(download.absolutePath, 'utf8')
  const backup = JSON.parse(text) as {
    app: string
    version: number
    folders: { id: string }[]
    wallets: { address: string }[]
    connections: { id: string; credentials: { value: string }[] }[]
    pnlRecords: { id: string }[]
  }

  expect(download.suggestedFilename).toMatch(
    /^velox-backup-\d{4}-\d{2}-\d{2}\.json$/,
  )
  expect(text.startsWith('{\n  "app": "velox"')).toBe(true)
  expect(backup.version).toBe(1)
  expect(backup.folders.map((row) => row.id)).toEqual([folder.id])
  expect(backup.wallets.map((row) => row.address.toLowerCase())).toEqual([
    wallet.address.toLowerCase(),
  ])
  expect(backup.pnlRecords.map((row) => row.id)).toEqual([record.id])
  const openSea = backup.connections.find((row) => row.id === 'opensea')
  expect(openSea?.credentials[0]?.value).toBe('backup-key-1234')

  // A fresh install: the same stores, emptied, so the restore has nothing to
  // merge with except the connections migration seeded.
  await clearStores(browser)
  await app.open('/settings')
  await expect(screen.getByText(/delete app data/)).toBeVisible()

  const file = await writeBackupFile('round-trip.json', text)
  await browser.locator('input[type=file]').setInputFiles(file)

  const counts = screen.getByText(
    new RegExp(
      `holds 1 wallet, ${backup.connections.length} connections, 1 folder, 1 PnL record`,
    ),
  )
  await expect(counts).toBeVisible()

  await screen.getByRole('button', 'Import').click()

  await expect(screen.getByRole('button', /OpenSea/)).toContainText('1234')

  await app.open('/wallet-profiles')
  await expect(
    screen.getByRole('table', 'Wallets in Export Check'),
  ).toBeVisible()
  await expect(
    screen.getByRole('row').filter({ hasText: 'exporter' }),
  ).toBeVisible()

  await app.open('/pnl/monthly')
  await expect(
    screen.getByRole('row').filter({ hasText: 'Mock Collection' }),
  ).toBeVisible()
})

test('a backup from a newer version is refused and writes nothing', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Refuse Check')
  const wallet = walletRow({
    label: 'keeper',
    privateKey: generatePrivateKey(),
    folderId: folder.id,
  })

  await seedProfile(app, browser, { folders: [folder], wallets: [wallet] })

  const file = await writeBackupFile('newer.json', backupDocument({ version: 2 }))
  await browser.locator('input[type=file]').setInputFiles(file)

  await expect(
    screen.getByText(/written by a newer version of Velox/),
  ).toBeVisible()
  await expect(screen.getByRole('button', 'Import')).not.toBeVisible()
  expect(await rowCount(browser, 'wallets')).toBe(1)
})

test('a damaged document is refused and leaves the store untouched', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Damage Check')
  const wallet = walletRow({
    label: 'keeper',
    privateKey: generatePrivateKey(),
    folderId: folder.id,
  })

  await seedProfile(app, browser, { folders: [folder], wallets: [wallet] })

  const input = browser.locator('input[type=file]')

  await input.setInputFiles(await writeBackupFile('broken.json', '{"app":'))
  await expect(screen.getByText('This file is not valid JSON.')).toBeVisible()

  await input.setInputFiles(
    await writeBackupFile(
      'mismatch.json',
      backupDocument({
        wallets: [{ ...wallet, privateKey: generatePrivateKey() }],
      }),
    ),
  )
  await expect(
    screen.getByText(/does not match its address/),
  ).toBeVisible()

  await expect(screen.getByRole('button', 'Import')).not.toBeVisible()
  expect(await rowCount(browser, 'wallets')).toBe(1)
})

// The OpenSea collection response carries no name for some collections, and
// the writer stores the empty string it gets, so that row has to come back.
test('a PnL row saved with no collection name still round-trips', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Nameless Check')
  const wallet = walletRow({
    label: 'nameless',
    privateKey: generatePrivateKey(),
    folderId: folder.id,
  })

  await seedProfile(app, browser, {
    folders: [folder],
    wallets: [wallet],
    pnlRecords: [pnlRecordFixture({ name: '' })],
  })

  const download = await browser.waitForDownload(() =>
    screen.getByRole('button', 'Export').click(),
  )
  const text = await readFile(download.absolutePath, 'utf8')

  await clearStores(browser)
  await app.open('/settings')
  await browser
    .locator('input[type=file]')
    .setInputFiles(await writeBackupFile('nameless.json', text))

  await screen.getByRole('button', 'Import').click()
  await expect(screen.getByText(/Imported 1 wallet/)).toBeVisible()

  await app.open('/pnl/monthly')
  await expect(
    screen.getByRole('row').filter({ hasText: '1.0000 ETH' }),
  ).toBeVisible()
})

test('a row that lost a field the readers use is refused whole', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Partial Check')
  const wallet = walletRow({
    label: 'partial',
    privateKey: generatePrivateKey(),
    folderId: folder.id,
  })
  const record = pnlRecordFixture({ name: 'Partial Collection' })
  const partial: Record<string, unknown> = { ...record }
  delete partial.chain

  await app.open('/settings')
  const input = browser.locator('input[type=file]')

  await input.setInputFiles(
    await writeBackupFile(
      'missing-chain.json',
      backupDocument({
        folders: [folder],
        wallets: [wallet],
        pnlRecords: [partial],
      }),
    ),
  )
  await expect(screen.getByText(/PnL record 1 has no chain/)).toBeVisible()

  // A credential with no value throws when the settings list renders its
  // summary, so this row must never reach the store.
  const credentialless = {
    kind: 'data-api',
    id: 'opensea',
    name: 'OpenSea',
    order: 0,
    autoFallback: true,
    credentials: [{ id: 'key' }],
    updatedAt: Date.now(),
  }

  await input.setInputFiles(
    await writeBackupFile(
      'missing-value.json',
      backupDocument({
        folders: [folder],
        wallets: [wallet],
        connections: [credentialless],
      }),
    ),
  )
  await expect(screen.getByText(/credential with no value/)).toBeVisible()

  await expect(screen.getByRole('button', 'Import')).not.toBeVisible()
  expect(await rowCount(browser, 'wallets')).toBe(0)
  expect(await rowCount(browser, 'pnl-records')).toBe(0)
})

test('a restored wallet signs a transfer', async ({ app, browser, screen }) => {
  const folder = walletFolder('Restored Signer')
  const [wallet] = mintWallets(1, folder.id)

  await mockCollection(browser, {
    slug: SLUG,
    body: collectionFixture({
      slug: SLUG,
      name: 'Restored Drop',
      contract: CONTRACT,
    }),
  })
  await mockHoldings(browser, {
    chain: 'robinhood',
    address: wallet.address,
    body: holdingsFixture([{ contract: CONTRACT, identifier: TOKEN_ID }]),
  })
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545\/?$/,
    allowWrites: true,
    ethCall: { [SUPPORTS_INTERFACE]: word(1) },
  })

  await app.open('/settings')
  await browser
    .locator('input[type=file]')
    .setInputFiles(
      await writeBackupFile(
        'signer.json',
        backupDocument({
          folders: [folder],
          wallets: [wallet],
          connections: [robinhoodRpc(RPC_URL), openseaConnection('restored-key')],
        }),
      ),
    )
  await screen.getByRole('button', 'Import').click()

  await app.open('/transfer')
  await scanCollection({
    browser,
    screen,
    feature: 'transfer',
    collection: SLUG,
    folder: folder.name,
  })
  await screen.getByRole('checkbox', { name: `Select token #${TOKEN_ID}` }).check()
  await screen.getByLabel('Or paste an address').fill(DESTINATION)
  await screen.getByLabel('Or paste an address').press('Tab')
  await screen
    .getByRole('button', { name: `Transfer ${TOKEN_ID} NFT` })
    .click()

  await expect.poll(() => rpc.count('eth_sendRawTransaction')).toBe(1)
  const broadcast = rpc.calls.filter(
    (call) => call.method === 'eth_sendRawTransaction',
  )
  const sender = await recoverTransactionAddress({
    serializedTransaction: String(broadcast[0]?.params[0]) as `0x${string}`,
  })
  expect(sender.toLowerCase()).toBe(wallet.address.toLowerCase())
})

type BackupFields = {
  folders?: unknown[]
  wallets?: unknown[]
  connections?: unknown[]
  pnlRecords?: unknown[]
  version?: number
}

type App = { open: (path: string) => Promise<unknown> }

async function seedProfile(
  app: App,
  page: Page,
  seed: Parameters<typeof seedVelox>[1],
): Promise<void> {
  await app.open('/settings')
  await seedVelox(page, seed)
  await app.open('/settings')
}

function backupDocument(fields: BackupFields = {}): string {
  return JSON.stringify({
    app: 'velox',
    version: fields.version ?? 1,
    exportedAt: Date.now(),
    folders: fields.folders ?? [],
    wallets: fields.wallets ?? [],
    connections: fields.connections ?? [],
    pnlRecords: fields.pnlRecords ?? [],
  })
}

test('values the pages cannot read are refused', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Value Check')
  const wallet = walletRow({
    label: 'value',
    privateKey: generatePrivateKey(),
    folderId: folder.id,
  })
  const record = pnlRecordFixture({ name: 'Value Collection' })

  // The endpoint pane reads `probe.status` on anything that is not null, so an
  // endpoint without the key has to be refused rather than applied.
  const noProbe: Record<string, unknown> = { ...robinhoodRpc(RPC_URL) }
  noProbe.endpoints = (noProbe.endpoints as Record<string, unknown>[]).map(
    (endpoint) => {
      const copy: Record<string, unknown> = { ...endpoint }
      delete copy.probe
      return copy
    },
  )

  const input = browser.locator('input[type=file]')
  await app.open('/settings')

  await input.setInputFiles(
    await writeBackupFile(
      'bad-amount.json',
      backupDocument({
        folders: [folder],
        wallets: [wallet],
        pnlRecords: [{ ...record, netPnl: 'oops' }],
      }),
    ),
  )
  await expect(
    screen.getByText(/net PnL that is not an amount/),
  ).toBeVisible()

  await input.setInputFiles(
    await writeBackupFile(
      'bad-breakdown.json',
      backupDocument({
        folders: [folder],
        wallets: [wallet],
        pnlRecords: [{ ...record, breakdown: null }],
      }),
    ),
  )
  await expect(
    screen.getByText(/breakdown that is not an object/),
  ).toBeVisible()

  await input.setInputFiles(
    await writeBackupFile(
      'bad-probe.json',
      backupDocument({
        folders: [folder],
        wallets: [wallet],
        connections: [noProbe],
      }),
    ),
  )
  await expect(
    screen.getByText(/endpoint with no probe state/),
  ).toBeVisible()

  await expect(screen.getByRole('button', 'Import')).not.toBeVisible()
  expect(await rowCount(browser, 'pnl-records')).toBe(0)
})

async function writeBackupFile(name: string, text: string): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true })
  const path = join(BACKUP_DIR, name)
  await writeFile(path, text, 'utf8')
  return path
}

async function clearStores(page: Page): Promise<void> {
  await page.evaluate(clearVeloxStores, undefined)
}

async function rowCount(page: Page, store: string): Promise<number> {
  return page.evaluate(countVeloxRows, store)
}
