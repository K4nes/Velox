import { useMemo } from 'react'
import { toast } from 'sonner'
import { usePageStore, usePageStoreScope } from '@/hooks/use-page-store'
import { resolveScanWallets, scanHeldTokens } from '@/lib/inventory/holdings'
import { toMessage } from '@/lib/core/message'
import type { PageStore } from '@/lib/core/page-store'
import { scanFailureMessage } from '@/lib/opensea/failure-message'
import { failureLine } from '@/lib/core/run-engine'
import { getCollection, slugFromUrl } from '@/lib/opensea/index'
import type { CollectionInfo } from '@/lib/opensea/index'
import { resolveScanTarget } from '@/lib/inventory/scan-target'
import { EMPTY_HOLDINGS } from '@/lib/inventory/holdings-fields'
import type { HoldingsFields } from '@/lib/inventory/holdings-fields'

export function useHoldingsScan(store?: PageStore<HoldingsFields>) {
  const scoped = usePageStoreScope(store, EMPTY_HOLDINGS)
  const fields = usePageStore(scoped)
  const isScanning = () => scoped.get().state.status === 'scanning'
  const scanning = isScanning()

  function changeUrl(next: string) {
    if (isScanning()) return
    scoped.set({ url: next, tokens: [], state: { status: 'idle' } })
  }

  function changeWallets(ids: string[]) {
    if (isScanning()) return
    scoped.set({ walletIds: ids, tokens: [], state: { status: 'idle' } })
  }

  async function scan() {
    if (isScanning()) return

    const run = scoped.open('scan')
    scoped.set({ tokens: [], state: { status: 'scanning' } })

    const { url, walletIds } = scoped.get()

    try {
      const target = await resolveScanTarget(url, walletIds)
      if (!run.live()) return
      if (target.status === 'failed') {
        scoped.set({ state: { status: 'failed', message: target.message } })
        return
      }

      const resolved = resolveScanWallets(target.wallets)

      let collection: CollectionInfo
      try {
        collection = await getCollection(target.slug)
      } catch (failure) {
        if (!run.live()) return
        const message = scanFailureMessage(failure, 'collection')
        scoped.set({ state: { status: 'failed', message } })
        toast.error(message)
        return
      }

      const result = await scanHeldTokens({
        chain: collection.chain,
        slug: collection.slug,
        wallets: resolved.wallets,
      })

      if (!run.live()) return

      scoped.set({
        tokens: result.tokens,
        state: { status: 'ready', collection, scans: result.scans },
      })

      const failed = result.scans.filter((scan) => scan.error !== null)
      if (failed.length > 0) {
        toast.error(
          failureLine(
            failed.length,
            result.scans.length,
            'wallets',
            failed[0]?.error ?? null
          )
        )
      }
    } catch (failure) {
      if (!run.live()) return
      const message = toMessage(failure)
      scoped.set({ state: { status: 'failed', message } })
    }
  }

  const term = fields.query.trim().toLowerCase()
  const rows = useMemo(
    () =>
      term === ''
        ? fields.tokens
        : fields.tokens.filter((row) =>
            [
              row.name,
              `#${row.tokenId}`,
              row.tokenId,
              row.owner.label,
              row.owner.address,
            ].some((value) => value.toLowerCase().includes(term))
          ),
    [fields.tokens, term]
  )

  return {
    url: fields.url,
    selectedWallets: fields.walletIds,
    state: fields.state,
    tokens: fields.tokens,
    rows,
    totalRows: fields.tokens.length,
    query: fields.query,
    setQuery: (next: string) => scoped.set({ query: next }),
    running: scanning,
    canScan:
      !scanning &&
      slugFromUrl(fields.url) !== null &&
      fields.walletIds.length > 0,
    collection: fields.state.status === 'ready' ? fields.state.collection : null,
    changeUrl,
    changeWallets,
    scan,
  }
}
