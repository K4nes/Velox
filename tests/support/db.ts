/**
 * Both helpers run inside `page.evaluate`, which serialises the function, so
 * each one is self-contained and closes over nothing.
 */

export async function clearVeloxStores(): Promise<void> {
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
