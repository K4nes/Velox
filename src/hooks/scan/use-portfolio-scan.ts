import { toast } from 'sonner'
import { usePageStore, usePageStoreScope } from '@/hooks/use-page-store'
import type { PageStore } from '@/lib/core/page-store'
import { resolveScanWallets } from '@/lib/inventory/holdings'
import { scanFailureMessage } from '@/lib/opensea/failure-message'
import { failureLine } from '@/lib/core/run-engine'
import { scanPortfolio } from '@/lib/inventory/portfolio'
import type {
  PortfolioScanResult,
  PortfolioScanState,
  PortfolioTableState,
} from '@/lib/inventory/portfolio'
import { resolveScanTarget } from '@/lib/inventory/scan-target'
import { createPortfolioState } from '@/pages/portfolio/state'
import type { PortfolioState } from '@/pages/portfolio/state'

export function describeTable(
  state: PortfolioScanState,
  collectionName: string
): PortfolioTableState {
  switch (state.status) {
    case 'idle':
      return {
        status: 'idle',
        message: 'Scan this collection to see what the selected wallets hold.',
      }
    case 'scanning':
      return state.snapshot.holdings.length > 0
        ? { status: 'ready' }
        : {
            status: 'loading',
            message: `Scanning ${state.snapshot.collection.name || collectionName}…`,
          }
    case 'ready': {
      if (state.result.holdings.length > 0) {
        return { status: 'ready' }
      }

      const failed = state.result.wallets.filter((wallet) => wallet.error !== null)
      if (failed.length === 0) {
        return {
          status: 'empty',
          message: `None of the selected wallets hold ${state.result.collection.name || collectionName}.`,
        }
      }

      return {
        status: 'error',
        message: `${failed.length} of ${state.result.wallets.length} wallets could not be read. ${failed[0]?.error ?? ''}`,
      }
    }
    case 'failed':
      return { status: 'error', message: state.message }
  }
}

function toastResult(result: PortfolioScanResult) {
  const failed = result.wallets.filter((wallet) => wallet.error !== null)
  if (failed.length > 0) {
    toast.error(
      failureLine(
        failed.length,
        result.wallets.length,
        'wallets',
        failed[0]?.error ?? null
      )
    )
    return
  }

  const unavailable = result.holdings.filter(
    (row) => row.rarity.status === 'missing' || row.rarity.status === 'failed'
  )
  if (unavailable.length === 0) return

  const firstFailure = unavailable.find((row) => row.rarity.status === 'failed')
  const message =
    firstFailure?.rarity.status === 'failed' ? firstFailure.rarity.message : 'Not found'
  toast.error(
    `${unavailable.length} ${unavailable.length === 1 ? 'token' : 'tokens'} could not be ranked — ${message}`
  )
}

export function usePortfolioScan(store?: PageStore<PortfolioState>) {
  const scoped = usePageStoreScope(store, createPortfolioState())
  const fields = usePageStore(scoped)

  function reset() {
    scoped.dropReads()
    scoped.set({ state: { status: 'idle' } })
  }

  function changeUrl(next: string) {
    scoped.set({ url: next })
    reset()
  }

  function changeWallets(ids: string[]) {
    scoped.set({ walletIds: ids })
    reset()
  }

  async function scan() {
    // A retained store keeps `starting` through a route change, so a remount cannot
    // launch a second scan while the first one is still reporting.
    if (scoped.get().starting) return

    const run = scoped.open('scan')
    scoped.set({ starting: true })

    try {
      const { url, walletIds } = scoped.get()
      const target = await resolveScanTarget(url, walletIds)
      if (!run.live()) return
      if (target.status === 'failed') {
        scoped.set({ state: { status: 'failed', message: target.message } })
        return
      }

      const resolved = resolveScanWallets(target.wallets)

      let result: PortfolioScanResult
      try {
        result = await scanPortfolio({
          slug: target.slug,
          wallets: resolved.wallets,
          collapsed: resolved.collapsed,
          onSnapshot: (snapshot) => {
            if (!run.live()) return
            scoped.set({ state: { status: 'scanning', snapshot } })
          },
        })
      } catch (failure) {
        if (!run.live()) return
        scoped.set({
          state: {
            status: 'failed',
            message: scanFailureMessage(failure, 'collection'),
          },
        })
        return
      }

      if (!run.live()) return
      scoped.set({ state: { status: 'ready', result } })
      toastResult(result)
    } finally {
      scoped.set({ starting: false })
    }
  }

  const { state } = fields
  const collectionName =
    state.status === 'scanning'
      ? state.snapshot.collection.name || state.snapshot.collection.slug
      : state.status === 'ready'
        ? state.result.collection.name || state.result.collection.slug
        : ''

  return {
    url: fields.url,
    selectedWallets: fields.walletIds,
    state,
    tableState: describeTable(state, collectionName),
    running: fields.starting || state.status === 'scanning',
    changeUrl,
    changeWallets,
    scan,
  }
}
