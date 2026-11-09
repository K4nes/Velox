export type FolderRow = { id: string; name: string; createdAt: number }

export type WalletRow = {
  id: string
  folderId: string
  label: string
  address: string
  privateKey: string
  createdAt: number
}

export type Seed = {
  folders?: FolderRow[]
  wallets?: WalletRow[]
  connections?: Record<string, unknown>[]
}

type Evaluator = {
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>
}

export async function seedVelox(page: Evaluator, seed: Seed): Promise<void> {
  await page.evaluate(async (data) => {
    const opened = Promise.withResolvers<IDBDatabase>()
    const request = indexedDB.open('velox')
    request.onsuccess = () => opened.resolve(request.result)
    request.onerror = () => opened.reject(request.error)
    const db = await opened.promise

    if (db.objectStoreNames.length === 0) {
      throw new Error('velox has no stores; call app.open() before seeding')
    }

    const write = (store: string, rows: unknown[]) => {
      const done = Promise.withResolvers<void>()
      const tx = db.transaction(store, 'readwrite')
      for (const row of rows) tx.objectStore(store).put(row)
      tx.oncomplete = () => done.resolve()
      tx.onerror = () => done.reject(tx.error)
      tx.onabort = () => done.reject(tx.error)
      return done.promise
    }

    if (data.folders !== undefined) await write('folders', data.folders)
    if (data.wallets !== undefined) await write('wallets', data.wallets)
    if (data.connections !== undefined) await write('connections', data.connections)

    db.close()
  }, seed)
}
