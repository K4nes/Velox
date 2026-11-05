import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { WalletSelect } from '@/components/wallet-select'
import { useTransferRun } from '@/hooks/use-transfer-run'
import { useTransferScan } from '@/hooks/use-transfer-scan'
import { Inventory } from '@/pages/transfer/inventory'
import { TransferRail } from '@/pages/transfer/rail'

export function TransferPage() {
  const scan = useTransferScan()
  const run = useTransferRun({
    wallets: scan.wallets,
    selections: scan.selection,
    chain: scan.collection?.chain ?? null,
    onSent: scan.applySent,
    onDeselect: scan.deselect,
  })

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
          aria-labelledby="transfer-wallet-label"
        >
          <span id="transfer-wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={scan.groups}
            selected={scan.selectedWallets}
            onSelectedChange={scan.changeWallets}
            disabled={scan.running || run.running}
            aria-labelledby="transfer-wallet-label"
            className="w-full"
          />
        </div>

        <Button
          className="shrink-0"
          onClick={check}
          disabled={!scan.canScan || run.running}
        >
          {scan.running ? <Spinner data-icon="inline-start" /> : <RefreshCw />}
          Rescan
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
          amounts={scan.amounts}
          standards={scan.standards}
          tokenStates={run.tokenStates}
          running={run.running}
          onToggleToken={scan.toggleToken}
          onToggleAll={scan.toggleAll}
          onAmountChange={scan.setAmount}
        />

        <TransferRail
          groups={scan.groups}
          wallets={scan.wallets}
          pickerSelection={run.pickerSelection}
          onPickWallet={run.pickWallet}
          destinationText={run.destinationText}
          onDestinationChange={run.changeDestination}
          destination={run.destination}
          selections={scan.selection}
          summary={run.summary}
          error={run.error}
          blockedReason={run.blockedReason}
          running={run.running}
          onTransfer={() => void run.start()}
        />
      </div>
    </div>
  )
}
