import { useEffect } from 'react'
import { usePageStore } from '@/hooks/use-page-store'
import { useSelection } from '@/hooks/use-selection'
import type { SelectionFields } from '@/hooks/use-selection'
import { useRun } from '@/hooks/run/use-run'
import type { RunState } from '@/hooks/run/use-run'
import { mapLimitSettled } from '@/lib/core/async'
import { FLOW_CONCURRENCY } from '@/lib/core/concurrency'
import type { PageStore } from '@/lib/core/page-store'
import type { ScanWallet } from '@/lib/inventory/holdings'
import {
  cancelSteps,
  pendingCancels,
  runCancelPlan,
  summarizeCancelRun,
} from '@/lib/listings/cancel-run'
import type {
  CancelRunProgress,
  CancelRunSummary,
  CancelStepState,
} from '@/lib/listings/cancel-run'
import { getActiveListings } from '@/lib/opensea/index'
import type { ActiveListing, CollectionInfo } from '@/lib/opensea/index'
import { scanFailureMessage } from '@/lib/opensea/failure-message'
import { listWallets } from '@/lib/wallet/wallets'

export type ActiveListingsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; failed: number; failure: string | null }
  | { status: 'failed'; message: string }

// The API names the offerer by address; the rail names it by the wallet label the
// operator picked, so the join happens where the wallets are known.
export type CancelListing = ActiveListing & { label: string }

export type CancelFields = RunState<CancelRunProgress> &
  SelectionFields & {
    listings: CancelListing[]
    read: ActiveListingsState
  }

// Every wallet is asked separately: the API filters by one maker at a time, and a
// wallet whose read fails must not erase the listings the other wallets returned.
async function readActiveListings(input: {
  store: PageStore<CancelFields>
  collection: CollectionInfo
  wallets: readonly ScanWallet[]
}): Promise<void> {
  const read = input.store.open('scan')
  input.store.set({ read: { status: 'loading' }, progress: null })

  const settled = await mapLimitSettled(
    input.wallets,
    FLOW_CONCURRENCY,
    async (wallet) =>
      (
        await getActiveListings({
          chain: input.collection.chain,
          contractAddress: input.collection.contractAddress,
          maker: wallet.address,
        })
      ).map((listing) => ({ ...listing, label: wallet.label }))
  )

  if (!read.live()) return

  if (settled.resolved.length === 0 && settled.firstError !== null) {
    input.store.set({
      read: {
        status: 'failed',
        message: scanFailureMessage(settled.firstError, 'wallet'),
      },
    })
    return
  }

  // A page cursor can repeat an order when a listing lands mid-read, and one order
  // is one row and one cancel request, so the merge collapses on the hash. The
  // holdings scan does the same with its own key.
  const byHash = new Map<string, CancelListing>()
  for (const entry of settled.resolved) {
    for (const listing of entry.value) {
      if (!byHash.has(listing.orderHash)) byHash.set(listing.orderHash, listing)
    }
  }

  const ordered = [...byHash.values()].sort(
    (a, b) => a.expiresAtSec - b.expiresAtSec
  )

  // Every order the read returns arrives selected, so the one-click cancel keeps
  // working; deselecting is what narrows the batch.
  input.store.set({
    listings: ordered,
    selectedKeys: ordered.map((listing) => listing.orderHash),
    read: {
      status: 'ready',
      failed: settled.failed.length,
      failure:
        settled.firstError === null
          ? null
          : scanFailureMessage(settled.firstError, 'wallet'),
    },
  })
}

export function useCancelRun(input: {
  collection: CollectionInfo | null
  // Held to one identity for as long as the scan stands, because the read below
  // re-runs when this list changes and a fresh array on every render would refetch
  // on every render.
  wallets: readonly ScanWallet[]
  // The rail fetches when its tab is opened, so a page that never opens it makes
  // no request.
  active: boolean
  store: PageStore<CancelFields>
}) {
  const fields = usePageStore(input.store)
  const run = useRun<CancelRunProgress>({ kind: 'cancel', store: input.store })

  const collection = input.collection
  const wallets = input.wallets

  useEffect(() => {
    if (!input.active) return
    if (!collection || wallets.length === 0) return
    if (input.store.get().running) return
    void readActiveListings({ store: input.store, collection, wallets })
  }, [input.active, input.store, collection, wallets])

  const steps: Map<string, CancelStepState> = run.progress
    ? cancelSteps(run.progress)
    : new Map()
  const summary: CancelRunSummary | null = run.progress
    ? summarizeCancelRun(run.progress)
    : null

  const select = useSelection(
    fields.listings,
    {
      keyOf: (listing) => listing.orderHash,
      // A withdrawn order is no longer part of any batch, so it drops out of the
      // select-all and loses its box rather than sitting checked and useless.
      isSelectable: (listing) =>
        steps.get(listing.orderHash)?.status !== 'cancelled',
    },
    input.store
  )

  const selected = new Set(select.selectedKeys)
  const pending = pendingCancels(fields.listings, run.progress).filter((listing) =>
    selected.has(listing.orderHash)
  )

  async function cancel() {
    if (collection === null || pending.length === 0) return

    await run.start(async ({ publish, shouldAbort }) => {
      const records = await listWallets()
      return runCancelPlan({
        listings: pending,
        wallets: records,
        onProgress: publish,
        shouldAbort,
      })
    })
  }

  async function reload() {
    if (!collection || wallets.length === 0) return
    await readActiveListings({
      store: input.store,
      collection,
      wallets,
    })
  }

  return {
    read: fields.read,
    listings: fields.listings,
    selectedKeys: select.selectedKeys,
    pending,
    steps,
    summary,
    running: run.running,
    error: run.error,
    cancel,
    reload,
    toggleOrder: select.toggle,
    toggleAll: select.toggleAll,
    reset: run.reset,
  }
}
