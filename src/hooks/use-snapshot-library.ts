import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useSnapshots } from '@/hooks/use-snapshots'
import { get } from '@/lib/db'
import { checkEligibility } from '@/lib/eligibility'
import { toMessage } from '@/lib/error-message'
import {
  buildSnapshotPayload,
  deleteSnapshot,
  saveSnapshot,
  updateSnapshot,
} from '@/lib/snapshots'
import type { EligibilitySnapshot, EligibilitySnapshotPayload } from '@/lib/snapshots'
import { listWallets } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export function useSnapshotLibrary() {
  const { snapshots, loading, error: snapshotsError, reload } = useSnapshots()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null
  )
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<{
    id: string
    message: string
  } | null>(null)
  const refreshingRef = useRef(false)
  const deletedRef = useRef(new Set<string>())
  const deletingRef = useRef(false)

  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null

  async function save(checked: EligibilitySnapshotPayload) {
    if (!checked || saving) return

    setSaving(true)
    setSaveError(null)
    try {
      await saveSnapshot(checked)
      toast.success('Snapshot saved', {
        description: checked.drop.name || checked.slug,
      })
      reload()
    } catch (failure) {
      setSaveError(toMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  async function remove(snapshotId: string) {
    // A second click lands on the next card's button once this one leaves the
    // grid, so the guard is a ref: state has not committed yet at that point.
    if (deletingRef.current) return
    deletingRef.current = true
    setDeletingId(snapshotId)
    // Recorded before the await so an in-flight refresh cannot write it back.
    deletedRef.current.add(snapshotId)
    setDeleteError(null)
    try {
      await deleteSnapshot(snapshotId)
      setSelectedSnapshotId((current) =>
        current === snapshotId ? null : current
      )
      reload()
    } catch (failure) {
      deletedRef.current.delete(snapshotId)
      setDeleteError(toMessage(failure))
    } finally {
      deletingRef.current = false
      setDeletingId(null)
    }
  }

  // Re-runs the same check against the same collection, so a stage the server
  // synced after the snapshot was saved replaces the stale row instead of
  // leaving the user with data they cannot tell apart from current.
  async function refresh(snapshot: EligibilitySnapshot) {
    if (refreshingRef.current) return

    refreshingRef.current = true
    setRefreshingId(snapshot.id)
    setRefreshError(null)

    try {
      const all = await listWallets()
      const byId = new Map(all.map((wallet) => [wallet.id, wallet]))
      const byAddress = new Map(
        all.map((wallet) => [wallet.address.toLowerCase(), wallet])
      )
      // A key can live in two folders as two records, so the id is the only
      // stable identity for a row; the address is the fallback.
      const picked = snapshot.rows
        .map(
          (row) =>
            byId.get(row.walletId) ??
            byAddress.get(row.address.toLowerCase())
        )
        .filter((wallet): wallet is StoredWallet => Boolean(wallet))
      const wallets = [...new Map(picked.map((wallet) => [wallet.id, wallet])).values()]
      if (wallets.length === 0) {
        throw new Error('No saved wallet matches this snapshot')
      }

      const result = await checkEligibility(snapshot.slug, wallets)
      // A wallet that failed mid-run comes back as an empty row, and writing it
      // over a good one would look like the collection changed.
      const failed = result.rows.filter((row) => row.error)
      if (failed.length > 0) {
        throw new Error(
          `${failed.length} wallet${failed.length === 1 ? '' : 's'} could not be checked. Snapshot left unchanged.`
        )
      }
      // The record can be deleted while the check runs, and an upsert would
      // bring it back. Both reads happen after the await so a delete that landed
      // during it is seen, not just one that landed before it.
      const stored = await get<EligibilitySnapshot>('snapshots', snapshot.id)
      if (deletedRef.current.has(snapshot.id) || !stored) {
        return
      }
      await updateSnapshot(
        snapshot.id,
        buildSnapshotPayload(result, snapshot.slug, snapshot.marketplace)
      )

      const dropped = snapshot.rows.length - wallets.length
      if (dropped > 0) {
        toast.info('Snapshot refreshed', {
          description: `${dropped} wallet${dropped === 1 ? '' : 's'} no longer exist and left the snapshot.`,
        })
      }
      reload()
    } catch (failure) {
      setRefreshError({
        id: snapshot.id,
        message: toMessage(failure),
      })
    } finally {
      refreshingRef.current = false
      setRefreshingId(null)
    }
  }

  return {
    snapshots,
    loading,
    snapshotsError,
    selectedSnapshot,
    selectedSnapshotId,
    setSelectedSnapshotId,
    saving,
    saveError,
    deleteError,
    deletingId,
    refreshingId,
    refreshError,
    save,
    remove,
    refresh,
    clearSaveError: () => setSaveError(null),
  }
}
