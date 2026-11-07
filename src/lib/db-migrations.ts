import { chains } from '@/config/chains'
import { seedPlan } from '@/lib/connection-model'

export type UpgradeContext = {
  /** The version the profile sat at before this upgrade. */
  fromVersion: number
  /** The stores that existed before the upgrade created any. */
  priorStores: ReadonlySet<string>
}

export type Migration = (
  transaction: IDBTransaction,
  context: UpgradeContext
) => void

// Keyed by the version the step brings a profile up to, so the open path only
// has to run the entries above the profile's current version.
export const migrations: Record<number, Migration> = {
  // Only a profile that already had the store holds rows keyed the old way.
  4: (transaction, { priorStores }) => {
    if (priorStores.has('pnl-records')) {
      migratePnlRecordIds(transaction.objectStore('pnl-records'))
    }
  },
  5: seedConnections,
  // A profile at 5 already holds the seeded rows, and step 5 seeds a new one
  // without a quicknode row, so retiring only applies to a pre-existing seed.
  6: (transaction, { fromVersion }) => {
    if (fromVersion >= 5) {
      retireQuickNodeSeed(transaction.objectStore('connections'))
    }
  },
}

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

// Version 6 retires the seeded QuickNode row: it is a paid provider with no URL
// the app can build, so it is no longer seeded and its provider id no longer
// exists. A row the user never touched is dropped; one carrying keys or
// endpoints becomes a custom provider so those URLs keep working.
function retireQuickNodeSeed(store: IDBObjectStore): void {
  const request = store.openCursor()

  request.onsuccess = () => {
    const cursor = request.result
    if (cursor === null) {
      return
    }

    const row = cursor.value as {
      provider?: string
      credentials?: unknown[]
      endpoints?: unknown[]
    }
    if (row.provider === 'quicknode') {
      const untouched =
        (row.credentials?.length ?? 0) === 0 &&
        (row.endpoints?.length ?? 0) === 0
      if (untouched) {
        cursor.delete()
      } else {
        cursor.update({ ...cursor.value, provider: 'custom' })
      }
    }
    cursor.continue()
  }
}
