export type StoreName = 'folders' | 'wallets' | 'secrets' | 'snapshots'

const DB_NAME = 'velox'
const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | undefined

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise
  }

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('wallets')) {
        const wallets = db.createObjectStore('wallets', { keyPath: 'id' })
        wallets.createIndex('folderId', 'folderId', { unique: false })
      }
      if (!db.objectStoreNames.contains('secrets')) {
        db.createObjectStore('secrets', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id' })
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
