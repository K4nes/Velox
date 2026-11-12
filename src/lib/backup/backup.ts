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

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export async function readBackup(): Promise<Backup> {
  const [folders, wallets, connections, pnlRecords] = await Promise.all([
    getAll<FolderRecord>('folders'),
    getAll<StoredWallet>('wallets'),
    getAll<Connection>('connections'),
    getAll<PnlRecord>('pnl-records'),
  ])

  return {
    app: APP_MARKER,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    folders,
    wallets,
    connections,
    pnlRecords,
  }
}

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
  // The settings list reads `credential.value` on every row, so a credential
  // without one throws as the page renders it.
  if (
    row.credentials.some(
      (credential) =>
        !isRecord(credential) ||
        typeof credential.id !== 'string' ||
        typeof credential.value !== 'string'
    )
  ) {
    return 'has a credential with no value'
  }
  if (row.kind === 'rpc') {
    if (!Array.isArray(row.endpoints)) return 'has no endpoint list'
    if (
      row.endpoints.some(
        (endpoint) =>
          !isRecord(endpoint) ||
          typeof endpoint.id !== 'string' ||
          typeof endpoint.chain !== 'string' ||
          typeof endpoint.url !== 'string'
      )
    ) {
      return 'has an endpoint with no chain or url'
    }
    // The endpoint pane reads `probe.status` on anything except null.
    if (row.endpoints.some((endpoint) => !isProbe(endpoint.probe))) {
      return 'has an endpoint with no probe state'
    }
  }
  // The provider list is sorted by this, and a missing value leaves the order
  // undefined instead of failing.
  if (typeof row.order !== 'number') return 'has no order'
  return null
}

function checkPnlRecord(row: Record<string, unknown>): string | null {
  if (!isText(row.id)) return 'has no id'
  // OpenSea answers with no name for some collections and the writer stores the
  // empty string, so that row has to come back rather than be refused.
  if (typeof row.name !== 'string') return 'has no name'
  if (typeof row.slug !== 'string') return 'has no slug'
  if (typeof row.chain !== 'string') return 'has no chain'
  if (typeof row.imageUrl !== 'string') return 'has no image URL'
  if (typeof row.day !== 'string') return 'has no day'
  if (typeof row.contract !== 'string') return 'has no contract'
  if (!Array.isArray(row.wallets)) return 'has no wallet list'
  if (!row.wallets.every((wallet) => typeof wallet === 'string')) {
    return 'has a wallet list that is not addresses'
  }
  // The monthly table converts this with BigInt while it renders.
  if (!isAmount(row.netPnl)) return 'has a net PnL that is not an amount'
  // A missing quote formats as `$NaN` on the monthly table, and a missing
  // completeness flag claims a partial read was complete.
  if (row.ethPriceUsd !== null && typeof row.ethPriceUsd !== 'number') {
    return 'has no USD price'
  }
  if (typeof row.truncated !== 'boolean' || typeof row.unpriced !== 'boolean') {
    return 'has no read completeness flags'
  }
  if (row.breakdown !== undefined) {
    const problem = checkBreakdown(row.breakdown)
    if (problem !== null) return problem
  }
  if (typeof row.createdAt !== 'number') return 'has no creation time'
  return null
}

// The split is versioned and readers branch on `v` being present, so both
// shapes are checked for the amounts and counts they hand to BigInt.
function checkBreakdown(value: unknown): string | null {
  if (!isRecord(value)) return 'has a breakdown that is not an object'

  if ('v' in value) {
    if (value.v !== 2) return 'has an unknown breakdown version'
    if (
      !isAmount(value.realized) ||
      !isAmount(value.spent) ||
      !isAmount(value.basis)
    ) {
      return 'has a breakdown with no amounts'
    }
  } else if (!isAmount(value.realized) || !isAmount(value.invested)) {
    return 'has a breakdown with no amounts'
  }

  if (!isCount(value.held) || !isCount(value.sold)) {
    return 'has a breakdown with no counts'
  }
  return null
}

function isAmount(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    BigInt(value)
    return true
  } catch {
    return false
  }
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isProbe(value: unknown): boolean {
  if (value === null) return true
  return isRecord(value) && (value.status === 'ok' || value.status === 'fail')
}
