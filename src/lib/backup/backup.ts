import type { Connection } from '@/lib/chain/connection-model'
import { getAll, putMany } from '@/lib/db/db'
import { dayKey, type PnlRecord } from '@/lib/pnl/pnl-records'
import type { FolderRecord } from '@/lib/wallet/wallet-model'
import { deriveAddress, type StoredWallet } from '@/lib/wallet/wallets'

// The marker a Velox backup carries. Bump it when a stored row in any of these
// stores changes meaning; a document written above this version is refused.
export const BACKUP_VERSION = 1

const APP_MARKER = 'velox'

export type Backup = {
  app: typeof APP_MARKER
  version: number
  exportedAt: number
  folders: FolderRecord[]
  wallets: StoredWallet[]
  connections: Connection[]
  pnlRecords: PnlRecord[]
}

export type BackupCounts = {
  folders: number
  wallets: number
  connections: number
  pnlRecords: number
}

// Every message here is operator copy, so a refusal names what is wrong with
// the file rather than the field the reader tripped on.
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export async function readBackup(now = Date.now()): Promise<Backup> {
  const [folders, wallets, connections, pnlRecords] = await Promise.all([
    getAll<FolderRecord>('folders'),
    getAll<StoredWallet>('wallets'),
    getAll<Connection>('connections'),
    getAll<PnlRecord>('pnl-records'),
  ])

  return {
    app: APP_MARKER,
    version: BACKUP_VERSION,
    exportedAt: now,
    folders,
    wallets,
    connections,
    pnlRecords,
  }
}

// Indented so the file opens as plain JSON in any editor, and a re-export diffs
// row by row instead of as one line.
export function backupJson(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export function backupFileName(at: number): string {
  return `velox-backup-${dayKey(new Date(at))}.json`
}

export function backupCounts(backup: Backup): BackupCounts {
  return {
    folders: backup.folders.length,
    wallets: backup.wallets.length,
    connections: backup.connections.length,
    pnlRecords: backup.pnlRecords.length,
  }
}

// Validates the whole document before the caller writes anything, so a damaged
// file cannot leave the store half-applied.
export function parseBackup(text: string): Backup {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new BackupError('This file is not valid JSON.')
  }

  if (!isRecord(value) || value.app !== APP_MARKER) {
    throw new BackupError('This file is not a Velox backup.')
  }

  const version = value.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupError('This file is not a Velox backup.')
  }
  if (version > BACKUP_VERSION) {
    throw new BackupError(
      `This backup was written by a newer version of Velox (backup version ${version}). Update Velox, then import it again.`
    )
  }

  return {
    app: APP_MARKER,
    version,
    exportedAt:
      typeof value.exportedAt === 'number' ? value.exportedAt : Date.now(),
    folders: rows(value.folders, 'folder', checkFolder),
    wallets: rows(value.wallets, 'wallet', checkWallet),
    connections: rows(value.connections, 'connection', checkConnection),
    pnlRecords: rows(value.pnlRecords, 'PnL record', checkPnlRecord),
  }
}

// One transaction over the four stores, so an import that fails on a quota
// error leaves the profile as it was instead of with half the file applied.
export async function applyBackup(backup: Backup): Promise<void> {
  await putMany([
    { store: 'folders', rows: backup.folders },
    { store: 'wallets', rows: backup.wallets },
    { store: 'connections', rows: backup.connections },
    { store: 'pnl-records', rows: backup.pnlRecords },
  ])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

// A row check answers with what is wrong with the row, or null when it is
// usable.
type RowCheck = (row: Record<string, unknown>) => string | null

function rows<T>(value: unknown, label: string, check: RowCheck): T[] {
  if (!Array.isArray(value)) {
    throw new BackupError(`The backup is damaged: ${label}s must be a list.`)
  }

  return value.map((row, index) => {
    const problem = isRecord(row) ? check(row) : 'is not an object'
    if (problem !== null) {
      throw new BackupError(
        `The backup is damaged: ${label} ${index + 1} ${problem}.`
      )
    }
    return row as T
  })
}

function checkFolder(row: Record<string, unknown>): string | null {
  if (!isText(row.id)) return 'has no id'
  if (!isText(row.name)) return 'has no name'
  if (typeof row.createdAt !== 'number') return 'has no creation time'
  return null
}

function checkWallet(row: Record<string, unknown>): string | null {
  if (!isText(row.id)) return 'has no id'
  if (typeof row.folderId !== 'string') return 'has no folder'
  if (typeof row.label !== 'string') return 'has no label'
  if (!isText(row.address)) return 'has no address'
  if (!isText(row.privateKey)) return 'has no private key'

  let derived: string
  try {
    derived = deriveAddress(row.privateKey as string)
  } catch {
    return 'has a private key that is not a valid secp256k1 key'
  }
  // A key that does not sign for the stored address holds a wallet that can
  // never sign from it, which is worse than a refusal the operator can act on.
  if (derived !== (row.address as string).toLowerCase()) {
    return 'has a private key that does not match its address'
  }

  if (typeof row.createdAt !== 'number') return 'has no creation time'
  return null
}

function checkConnection(row: Record<string, unknown>): string | null {
  if (!isText(row.id)) return 'has no id'
  if (typeof row.name !== 'string') return 'has no name'
  if (row.kind !== 'data-api' && row.kind !== 'rpc') return 'has no kind'
  if (!Array.isArray(row.credentials)) return 'has no credential list'
  if (row.kind === 'rpc' && !Array.isArray(row.endpoints)) {
    return 'has no endpoint list'
  }
  // The provider list is sorted by this, and a missing value leaves the order
  // undefined instead of failing.
  if (typeof row.order !== 'number') return 'has no order'
  return null
}

function checkPnlRecord(row: Record<string, unknown>): string | null {
  if (!isText(row.id)) return 'has no id'
  if (!isText(row.name)) return 'has no name'
  if (typeof row.day !== 'string') return 'has no day'
  if (typeof row.contract !== 'string') return 'has no contract'
  if (!Array.isArray(row.wallets)) return 'has no wallet list'
  if (typeof row.netPnl !== 'string') return 'has no net PnL'
  if (typeof row.createdAt !== 'number') return 'has no creation time'
  return null
}
