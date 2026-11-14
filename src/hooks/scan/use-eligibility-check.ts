import { usePageStore, usePageStoreScope } from '@/hooks/use-page-store'
import { toMessage } from '@/lib/core/message'
import type { PageStore } from '@/lib/core/page-store'
import { checkEligibility } from '@/lib/opensea/eligibility'
import type { EligibilityTableState } from '@/lib/opensea/eligibility'
import { resolveScanTarget } from '@/lib/inventory/scan-target'
import { buildSnapshotPayload, marketplaceFromSource } from '@/lib/mint/snapshots'
import { createMintEligibilityState } from '@/pages/mint/state'
import type { MintEligibilityState } from '@/pages/mint/state'

export function useEligibilityCheck(
  store: PageStore<MintEligibilityState>,
  onResetSaveError: () => void
) {
  const scoped = usePageStoreScope(store, createMintEligibilityState())
  const {
    walletIds: selectedWallets,
    url,
    checked,
    error,
    running,
  } = usePageStore(scoped)

  const tableState: EligibilityTableState = error
    ? { status: 'error', message: error }
    : selectedWallets.length === 0
      ? { status: 'empty', message: 'Select at least one wallet' }
      : checked
        ? { status: 'ready', rows: checked.rows }
        : { status: 'empty', message: 'No data yet' }

  // An input edit abandons the request that read the old value.
  function invalidateRun() {
    scoped.dropReads()
    scoped.set({ running: false })
  }

  function changeUrl(next: string) {
    scoped.set({ url: next, checked: null, error: null })
    onResetSaveError()
    invalidateRun()
  }

  function changeWallets(ids: string[]) {
    scoped.set({ walletIds: ids, checked: null, error: null })
    onResetSaveError()
    invalidateRun()
  }

  async function check() {
    if (scoped.get().running) return

    // Read off the raw input before the first await, so the saved payload
    // describes the URL that produced it.
    const marketplace = marketplaceFromSource(scoped.get().url)
    const target = scoped.get()
    scoped.set({ checked: null })
    onResetSaveError()

    const run = scoped.open('scan')
    scoped.set({ running: true, error: null })

    try {
      const resolved = await resolveScanTarget(target.url, target.walletIds)
      if (!run.live()) return
      if (resolved.status === 'failed') {
        scoped.set({ error: resolved.message })
        return
      }

      const result = await checkEligibility(resolved.slug, resolved.wallets)
      if (!run.live()) return
      scoped.set({ checked: buildSnapshotPayload(result, resolved.slug, marketplace) })
    } catch (failure) {
      if (!run.live()) return
      scoped.set({ error: toMessage(failure) })
    } finally {
      if (run.live()) {
        scoped.set({ running: false })
      }
    }
  }

  return {
    selectedWallets,
    url,
    checked,
    error,
    running,
    tableState,
    changeUrl,
    changeWallets,
    check,
  }
}
