import { chainBySlug } from '@/config/chains'
import { getAll, put, remove } from '@/lib/db'
import { buildStageColumns } from '@/lib/eligibility'
import type { EligibilityResult, EligibilityRow, StageColumn } from '@/lib/eligibility'
import type { DropInfo } from '@/lib/opensea'

export type Marketplace = 'OpenSea' | 'Scatter'

export type EligibilitySnapshotPayload = {
  slug: string
  marketplace: Marketplace
  chainName: string
  drop: DropInfo
  imageUrl: string
  stageColumns: StageColumn[]
  rows: EligibilityRow[]
}

export type EligibilitySnapshot = EligibilitySnapshotPayload & {
  id: string
  createdAt: number
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function marketplaceFromSource(raw: string): Marketplace {
  return /scatter\.art/i.test(raw) ? 'Scatter' : 'OpenSea'
}

export function buildSnapshotPayload(
  result: EligibilityResult,
  slug: string,
  marketplace: Marketplace
): EligibilitySnapshotPayload {
  return {
    slug,
    marketplace,
    chainName: chainBySlug(result.drop.chain)?.name ?? result.drop.chain,
    drop: result.drop,
    imageUrl: result.imageUrl,
    stageColumns: buildStageColumns(result),
    rows: result.rows,
  }
}

export async function listSnapshots(): Promise<EligibilitySnapshot[]> {
  const snapshots = await getAll<EligibilitySnapshot>('snapshots')
  return [...snapshots].sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveSnapshot(
  payload: EligibilitySnapshotPayload
): Promise<EligibilitySnapshot> {
  const snapshot: EligibilitySnapshot = {
    ...payload,
    id: uid(),
    createdAt: Date.now(),
  }
  await put<EligibilitySnapshot>('snapshots', snapshot)
  return snapshot
}

export function deleteSnapshot(id: string): Promise<void> {
  return remove('snapshots', id)
}

// Refreshing rewrites the stored payload under the same id, so the snapshot
// keeps its place in the list and its date describes the data it holds.
export async function updateSnapshot(
  id: string,
  payload: EligibilitySnapshotPayload
): Promise<EligibilitySnapshot> {
  const snapshot: EligibilitySnapshot = {
    ...payload,
    id,
    createdAt: Date.now(),
  }
  await put<EligibilitySnapshot>('snapshots', snapshot)
  return snapshot
}

export function summarizeSnapshot(snapshot: EligibilitySnapshot): {
  wallets: number
  eligible: number
} {
  return {
    wallets: snapshot.rows.length,
    eligible: snapshot.rows.filter((row) =>
      row.stages.some((stage) => stage.eligible)
    ).length,
  }
}

export function formatSnapshotDate(createdAt: number): string {
  return dateFormat.format(createdAt)
}

function uid() {
  try {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // randomUUID throws on non-secure origins; fall through to the fallback id.
  }
  return `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
