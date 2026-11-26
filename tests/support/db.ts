/**
 * The functions handed to `page.evaluate` run inside the page, which
 * serialises them, so each one is self-contained and closes over nothing.
 */

export async function clearVeloxStores(): Promise<boolean> {
  const opened = Promise.withResolvers<IDBDatabase>()
  const request = indexedDB.open('velox')
  request.onsuccess = () => opened.resolve(request.result)
  request.onerror = () => opened.reject(request.error)
  const db = await opened.promise

  const stores = ['folders', 'wallets', 'connections', 'pnl-records', 'snapshots']
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
  return true
}

type Evaluator = {
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>
}

export type LegacySecret = { id: string; value: string }

/** A `pnl-records` row in the version 3 shape, keyed by collection, wallets and day. */
export type LegacyPnlRecord = {
  id: string
  createdAt: number
  day: string
  slug: string
  name: string
  imageUrl: string
  chain: string
  contract: string
  wallets: string[]
  netPnl: string
  ethPriceUsd: number | null
  truncated: boolean
  unpriced: boolean
}

/** A connection row as version 5 wrote it, provider id included. */
export type LegacyConnection = {
  kind: 'data-api' | 'rpc'
  id: string
  name: string
  order: number
  autoFallback: boolean
  credentials: { id: string; value: string }[]
  endpoints?: { id: string; chain: string; url: string; probe: null }[]
  provider?: string
  updatedAt: number
}

export type LegacyProfileSeed = {
  /** The database version the profile sat at before the app opens it. */
  version: 3 | 5
  secrets: LegacySecret[]
  pnlRecords: LegacyPnlRecord[]
  connections: LegacyConnection[]
}

/**
 * Writes a pre-migration `velox` database and closes it, so the next app open
 * runs the upgrade. Run it on a same-origin page the app does not boot, such
 * as a static asset: opening the app first would take the database to the
 * current version and leave nothing to migrate.
 */
export async function seedLegacyProfile(
  page: Evaluator,
  seed: LegacyProfileSeed,
): Promise<void> {
  await page.evaluate(async (data) => {
    const opened = Promise.withResolvers<IDBDatabase>()
    const request = indexedDB.open('velox', data.version)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('wallets')) {
        const wallets = db.createObjectStore('wallets', { keyPath: 'id' })
        wallets.createIndex('folderId', 'folderId', { unique: false })
      }
      // Version 5 replaced this store's rows, but the store outlived them, so
      // a version 5 profile still has it.
      if (!db.objectStoreNames.contains('secrets')) {
        db.createObjectStore('secrets', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('pnl-records')) {
        db.createObjectStore('pnl-records', { keyPath: 'id' })
      }
      if (data.version >= 5 && !db.objectStoreNames.contains('connections')) {
        db.createObjectStore('connections', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => opened.resolve(request.result)
    request.onerror = () => opened.reject(request.error)
    const db = await opened.promise

    const write = (store: string, rows: readonly unknown[]) => {
      if (rows.length === 0) return Promise.resolve()
      const done = Promise.withResolvers<void>()
      const tx = db.transaction(store, 'readwrite')
      for (const row of rows) tx.objectStore(store).put(row)
      tx.oncomplete = () => done.resolve()
      tx.onerror = () => done.reject(tx.error)
      tx.onabort = () => done.reject(tx.error)
      return done.promise
    }

    await write('secrets', data.secrets)
    await write('pnl-records', data.pnlRecords)
    await write('connections', data.connections)

    db.close()
  }, seed)
}

/** Reads one store from the already-opened profile, for assertions on migrated rows. */
export async function readVeloxRows<T>(
  page: Evaluator,
  store: string,
): Promise<T[]> {
  return page.evaluate(async (name) => {
    const opened = Promise.withResolvers<IDBDatabase>()
    const request = indexedDB.open('velox')
    request.onsuccess = () => opened.resolve(request.result)
    request.onerror = () => opened.reject(request.error)
    const db = await opened.promise

    const rows = Promise.withResolvers<T[]>()
    const all = db.transaction(name, 'readonly').objectStore(name).getAll()
    all.onsuccess = () => rows.resolve(all.result as T[])
    all.onerror = () => rows.reject(all.error)
    const result = await rows.promise
    db.close()
    return result
  }, store)
}

export async function countVeloxRows(store: string): Promise<number> {
  const opened = Promise.withResolvers<IDBDatabase>()
  const request = indexedDB.open('velox')
  request.onsuccess = () => opened.resolve(request.result)
  request.onerror = () => opened.reject(request.error)
  const db = await opened.promise

  const counted = Promise.withResolvers<number>()
  const transaction = db.transaction(store, 'readonly')
  const countRequest = transaction.objectStore(store).count()
  countRequest.onsuccess = () => counted.resolve(countRequest.result)
  countRequest.onerror = () => counted.reject(countRequest.error)
  const total = await counted.promise
  db.close()
  return total
}
