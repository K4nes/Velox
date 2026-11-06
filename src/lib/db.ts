import { chains } from '@/config/chains'
import { seedPlan } from '@/lib/connection-model'

export type StoreName =
  | 'folders'
  | 'wallets'
  | 'snapshots'
  | 'pnl-records'
  | 'connections'

const DB_NAME = 'velox'
const DB_VERSION = 5

let dbPromise: Promise<IDBDatabase> | undefined

type LegacyPnlRecord = {
  id: string
  contract: string
  day: string
  createdAt: number
  truncated: boolean
  unpriced: boolean
}

function isPreferred(candidate: LegacyPnlRecord, current: LegacyPnlRecord): boolean {
  const candidateComplete = !candidate.truncated && !candidate.unpriced
  const currentComplete = !current.truncated && !current.unpriced
  // A partial read measured part of the position, so it must never replace a
  // complete snapshot of the same day, however much newer it is.
  if (candidateComplete !== currentComplete) return candidateComplete
  return candidate.createdAt > current.createdAt
}

// Version 3 keyed a row by collection, wallet set and day. Version 4 keys it by
// collection and day, so a re-check replaces the day's snapshot. The cursor
// runs inside the versionchange transaction; a transaction opened from its
// callback would wait on the upgrade that is waiting on the cursor.
function migratePnlRecordIds(store: IDBObjectStore): void {
  const winners = new Map<string, LegacyPnlRecord>()
  const request = store.openCursor()

  request.onsuccess = () => {
    const cursor = request.result
    if (cursor === null) {
      for (const [id, record] of winners) {
        store.put({ ...record, id })
      }
      return
    }

    const record = cursor.value as LegacyPnlRecord
    const id = `${record.contract.toLowerCase()}|${record.day}`
    const current = winners.get(id)
    if (current === undefined || isPreferred(record, current)) {
      winners.set(id, record)
    }
    cursor.delete()
    cursor.continue()
  }
}

// Version 5 replaces the `secrets` key/value store with the connections
// registry. The read, the seeded rows, and the deletes share the versionchange
// transaction, so a crash cannot leave a half-migrated profile that seeds twice.
function seedConnections(transaction: IDBTransaction): void {
  const connections = transaction.objectStore('connections')
  const write = (rows: readonly { id: string; value: string }[]) => {
    const plan = seedPlan(
      rows,
      Date.now(),
      chains.map((chain) => chain.slug)
    )
    for (const connection of plan) {
      connections.put(connection)
    }
  }

  // A fresh profile has nothing to migrate, and the upgrade never creates the
  // store for one.
  if (!transaction.db.objectStoreNames.contains('secrets')) {
    write([])
    return
  }

  const secrets = transaction.objectStore('secrets')
  const rows: { id: string; value: string }[] = []
  const request = secrets.openCursor()

  request.onsuccess = () => {
    const cursor = request.result
    if (cursor === null) {
      write(rows)
      // Delete only what the plan read. An id it does not map, such as a chain
      // dropped from config, stays in place instead of being destroyed.
      for (const row of rows) {
        if (isMigratedSecret(row.id)) {
          secrets.delete(row.id)
        }
      }
      return
    }

    const record = cursor.value as { id: string; value: string }
    rows.push({ id: record.id, value: record.value })
    cursor.continue()
  }
}

function isMigratedSecret(id: string): boolean {
  if (id === 'opensea-api-key') {
    return true
  }
  if (!id.startsWith('rpc:')) {
    return false
  }
  const slug = id.slice('rpc:'.length)
  return chains.some((chain) => chain.slug === slug)
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise
  }

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const transaction = request.transaction
      const hasPnlRecords = db.objectStoreNames.contains('pnl-records')
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('wallets')) {
        const wallets = db.createObjectStore('wallets', { keyPath: 'id' })
        wallets.createIndex('folderId', 'folderId', { unique: false })
      }
      if (!db.objectStoreNames.contains('secrets') && event.oldVersion > 0) {
        db.createObjectStore('secrets', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id' })
      }
      if (!hasPnlRecords) {
        db.createObjectStore('pnl-records', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('connections')) {
        db.createObjectStore('connections', { keyPath: 'id' })
      }
      if (event.oldVersion < 4 && hasPnlRecords && transaction !== null) {
        migratePnlRecordIds(transaction.objectStore('pnl-records'))
      }
      if (event.oldVersion < 5 && transaction !== null) {
        seedConnections(transaction)
      }
    }

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open the velox database'))
    }
    // Without this the version bump hangs forever on a profile with a second
    // tab holding the older database open.
    request.onblocked = () => {
      reject(
        new Error(
          'Another tab is holding the older velox database open. Close it and retry.'
        )
      )
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        // The memoised handle is dead once closed; keep handing it out and
        // every later transaction throws InvalidStateError.
        dbPromise = undefined
      }
      // A close the browser forces, from cleared storage or a backing-store
      // error, fires `close` and not `versionchange`. Without this the dead
      // handle is handed out until the window reloads.
      db.onclose = () => {
        dbPromise = undefined
      }
      resolve(db)
    }
  })

  // A rejected open would otherwise be memoised forever and every later call
  // would inherit the same failure.
  void promise.catch(() => {
    dbPromise = undefined
  })
  dbPromise = promise

  return promise
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'))
    }
  })
}

function writeTransaction(db: IDBDatabase, store: StoreName, write: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite')
    write(transaction.objectStore(store))
    transaction.oncomplete = () => resolve()
    // A failed request bubbles to the transaction and aborts it, and only
    // `abort` carries the cause. Rejecting on `error` would report the generic
    // message and swallow a quota error.
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB write failed'))
    }
  })
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb()
  const transaction = db.transaction(store, 'readonly')
  return readRequest(transaction.objectStore(store).getAll() as IDBRequest<T[]>)
}

export async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDb()
  const transaction = db.transaction(store, 'readonly')
  return readRequest(transaction.objectStore(store).get(id) as IDBRequest<T | undefined>)
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb()
  await writeTransaction(db, store, (objectStore) => {
    objectStore.put(value)
  })
}

export async function remove(store: StoreName, id: string): Promise<void> {
  const db = await openDb()
  await writeTransaction(db, store, (objectStore) => {
    objectStore.delete(id)
  })
}
