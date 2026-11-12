import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { generatePrivateKey } from 'viem/accounts'
import {
  openseaConnection,
  walletFolder,
  walletRow,
} from '../support/data'
import { pnlRecordFixture } from '../support/fixtures/pnl'
import { mockRpc } from '../support/rpc'
import { seedVelox } from '../support/seed'

type Page = Parameters<typeof seedVelox>[0]

const BACKUP_DIR = '.e2e/backups'

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
    connections: [openseaConnection('e2e-opensea-1234')],
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
  // Indented JSON, so the file reads as a document rather than one long line.
  expect(text.startsWith('{\n  "app": "velox"')).toBe(true)
  expect(backup.version).toBe(1)
  expect(backup.folders.map((row) => row.id)).toEqual([folder.id])
  expect(backup.wallets.map((row) => row.address.toLowerCase())).toEqual([
    wallet.address.toLowerCase(),
  ])
  expect(backup.pnlRecords.map((row) => row.id)).toEqual([record.id])
  const openSea = backup.connections.find((row) => row.id === 'opensea')
  expect(openSea?.credentials[0]?.value).toBe('e2e-opensea-1234')

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
  // The folder comes back named, and the wallet is its row.
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

  await app.open('/settings')
  await seedVelox(browser, { folders: [folder], wallets: [wallet] })
  await app.open('/settings')

  const file = await writeBackupFile(
    'newer.json',
    JSON.stringify({
      app: 'velox',
      version: 2,
      exportedAt: Date.now(),
      folders: [],
      wallets: [],
      connections: [],
      pnlRecords: [],
    }),
  )
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

  await app.open('/settings')
  await seedVelox(browser, { folders: [folder], wallets: [wallet] })
  await app.open('/settings')

  const input = browser.locator('input[type=file]')

  await input.setInputFiles(await writeBackupFile('broken.json', '{"app":'))
  await expect(screen.getByText('This file is not valid JSON.')).toBeVisible()

  // A key that does not sign for the stored address would restore a wallet that
  // can never sign, so the whole document is refused.
  await input.setInputFiles(
    await writeBackupFile(
      'mismatch.json',
      JSON.stringify({
        app: 'velox',
        version: 1,
        exportedAt: Date.now(),
        folders: [],
        wallets: [{ ...wallet, privateKey: generatePrivateKey() }],
        connections: [],
        pnlRecords: [],
      }),
    ),
  )
  await expect(
    screen.getByText(/does not match its address/),
  ).toBeVisible()

  await expect(screen.getByRole('button', 'Import')).not.toBeVisible()
  expect(await rowCount(browser, 'wallets')).toBe(1)
})

async function writeBackupFile(name: string, text: string): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true })
  const path = join(BACKUP_DIR, name)
  await writeFile(path, text, 'utf8')
  return path
}

async function clearStores(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const opened = Promise.withResolvers<IDBDatabase>()
    const request = indexedDB.open('velox')
    request.onsuccess = () => opened.resolve(request.result)
    request.onerror = () => opened.reject(request.error)
    const db = await opened.promise

    const stores = ['folders', 'wallets', 'connections', 'pnl-records']
    const done = Promise.withResolvers<void>()
    const transaction = db.transaction(stores, 'readwrite')
    for (const store of stores) {
      transaction.objectStore(store).clear()
    }
    transaction.oncomplete = () => done.resolve()
    transaction.onerror = () => done.reject(transaction.error)
    transaction.onabort = () => done.reject(transaction.error)
    await done.promise
    db.close()
  })
}

async function rowCount(page: Page, store: string): Promise<number> {
  return page.evaluate(async (name) => {
    const opened = Promise.withResolvers<IDBDatabase>()
    const request = indexedDB.open('velox')
    request.onsuccess = () => opened.resolve(request.result)
    request.onerror = () => opened.reject(request.error)
    const db = await opened.promise

    const count = Promise.withResolvers<number>()
    const transaction = db.transaction(name, 'readonly')
    const countRequest = transaction.objectStore(name).count()
    countRequest.onsuccess = () => count.resolve(countRequest.result)
    countRequest.onerror = () => count.reject(countRequest.error)
    const total = await count.promise
    db.close()
    return total
  }, store)
}
