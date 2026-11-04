import { Scan } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { WalletSelect } from '@/components/wallet-select'
import { useBulkSellScan } from '@/hooks/use-bulk-sell-scan'
import { useListingRun } from '@/hooks/use-listing-run'
import { useWalletGroups } from '@/hooks/use-wallets'
import { Inventory } from '@/pages/bulk-sell/inventory'
import { ListingRail } from '@/pages/bulk-sell/listing-rail'

export function BulkSellPage() {
  const scan = useBulkSellScan()
  const run = useListingRun({
    selected: scan.selection,
    collection: scan.collection,
    onListed: scan.deselect,
  })
  const { groups } = useWalletGroups()

  function check() {
    run.reset()
    void scan.scan()
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
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
            disabled={scan.running || run.running}
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
            disabled={scan.running || run.running}
            aria-labelledby="bulk-wallet-label"
            className="w-full"
          />
        </div>

        <Button
          className="shrink-0"
          onClick={check}
          disabled={!scan.canScan || run.running}
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
          price={run.price}
          onPriceChange={run.setPrice}
          durationDays={run.durationDays}
          onDurationChange={run.setDuration}
          itemCount={scan.selection.length}
          symbol={scan.collection?.listingCurrency.symbol ?? 'ETH'}
          decimals={scan.collection?.listingCurrency.decimals ?? 18}
          estimatedTotals={run.estimatedTotals}
          summary={run.summary}
          error={run.error}
          blockedReason={run.blockedReason}
          running={run.running}
          onCreate={() => void run.start()}
        />
      </div>
    </div>
  )
}
