import { Scan } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { WalletSelect } from '@/components/wallet-select'
import { useBulkSellScan } from '@/hooks/scan/use-bulk-sell-scan'
import { useCancelRun } from '@/hooks/run/use-cancel-run'
import { useListingRun } from '@/hooks/run/use-listing-run'
import { useWalletGroups } from '@/hooks/data/use-wallets'
import { usePageStore } from '@/hooks/use-page-store'
import { Inventory } from '@/pages/bulk-sell/inventory'
import { ListingRail } from '@/pages/bulk-sell/listing-rail'
import { bulkSellCancelStore, bulkSellStore } from '@/pages/bulk-sell/store'
import type { BulkSellTab } from '@/pages/bulk-sell/state'

export function BulkSellPage() {
  const scan = useBulkSellScan(bulkSellStore)
  const fields = usePageStore(bulkSellStore)
  const run = useListingRun({
    selected: scan.selection,
    collection: scan.collection,
    onListed: scan.deselect,
    store: bulkSellStore,
  })
  // One identity per scan, because the cancel tab re-reads whenever this list
  // changes and a fresh array on every render would refetch on every render.
  const wallets = useMemo(
    () =>
      scan.state.status === 'ready'
        ? scan.state.scans.map((entry) => entry.wallet)
        : [],
    [scan.state]
  )
  const cancel = useCancelRun({
    collection: scan.collection,
    wallets,
    active: fields.tab === 'cancel',
    store: bulkSellCancelStore,
  })
  const { groups } = useWalletGroups()

  function check() {
    run.reset()
    void scan.scan()
  }

  function changeTab(tab: BulkSellTab) {
    bulkSellStore.set({ tab })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 lg:h-[calc(100svh-3rem)] lg:flex-none lg:min-h-0 lg:overflow-hidden">
      <Card className="gap-3 p-4 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="collection-url" className="text-xs font-medium">
            Collection URL or slug (OpenSea / Scatter)
          </label>
          <Input
            id="collection-url"
            value={scan.url}
            onChange={(event) => scan.changeUrl(event.target.value)}
            placeholder="https://opensea.io/collection/… or https://scatter.art/…"
            disabled={scan.running || run.running || cancel.running}
          />
        </div>

        <div
          className="flex flex-col gap-1.5 lg:w-[280px]"
          role="group"
          aria-labelledby="bulk-wallet-label"
        >
          <span id="bulk-wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={groups}
            selected={scan.selectedWallets}
            onSelectedChange={scan.changeWallets}
            disabled={scan.running || run.running || cancel.running}
            aria-labelledby="bulk-wallet-label"
            className="w-full"
          />
        </div>

        <Button
          className="shrink-0"
          onClick={check}
          disabled={!scan.canScan || run.running || cancel.running}
        >
          {scan.running ? <Spinner data-icon="inline-start" /> : <Scan />}
          Scan held NFTs
        </Button>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Inventory
          state={scan.state}
          rows={scan.rows}
          totalRows={scan.totalRows}
          query={scan.query}
          onQueryChange={scan.setQuery}
          selectedKeys={scan.selectedKeys}
          tokenStates={run.tokenStates}
          running={run.running}
          onToggleToken={scan.toggleToken}
          onToggleAll={scan.toggleAll}
        />

        <ListingRail
          tab={fields.tab}
          onTabChange={changeTab}
          create={{
            price: run.price,
            onPriceChange: run.setPrice,
            durationDays: run.durationDays,
            onDurationChange: run.setDuration,
            itemCount: scan.selection.length,
            symbol: scan.collection?.listingCurrency.symbol ?? 'ETH',
            decimals: scan.collection?.listingCurrency.decimals ?? 18,
            estimatedTotals: run.estimatedTotals,
            summary: run.summary,
            error: run.error,
            blockedReason: run.blockedReason,
            running: run.running,
            onCreate: () => void run.start(),
          }}
          cancel={{
            read: cancel.read,
            listings: cancel.listings,
            pending: cancel.pending,
            steps: cancel.steps,
            summary: cancel.summary,
            error: cancel.error,
            running: cancel.running,
            currency: scan.collection?.listingCurrency ?? {
              address: '',
              symbol: 'ETH',
              decimals: 18,
            },
            onCancel: () => void cancel.cancel(),
            onRetry: () => void cancel.reload(),
          }}
        />
      </div>
    </div>
  )
}
