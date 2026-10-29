import { useState } from 'react'
import { Gavel, RefreshCw, ScanLine, Search } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WalletSelect } from '@/components/wallet-select'
import { walletGroups } from '@/config/wallets'

const feeRows = [
  { label: 'Gross proceeds', value: '0' },
  { label: 'Marketplace fee · 1%', value: '0' },
  { label: 'Royalty fee', value: '–' },
]

const selectionStats = [
  { label: 'Selected', value: '0' },
  { label: 'Avg offer', value: '–' },
  { label: 'Floor', value: '–' },
]

export function InstantSellPage() {
  const [collectionUrl, setCollectionUrl] = useState('')
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [filter, setFilter] = useState('')

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="gap-3 p-4 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="collection-url" className="text-xs font-medium">
            Collection URL or slug (OpenSea / Scatter)
          </label>
          <Input
            id="collection-url"
            value={collectionUrl}
            onChange={(event) => setCollectionUrl(event.target.value)}
            placeholder="https://opensea.io/collection/... or https://scatter.art/..."
          />
        </div>
        <div
          className="flex flex-col gap-1.5 lg:w-[280px]"
          role="group"
          aria-labelledby="instant-sell-wallet-label"
        >
          <span id="instant-sell-wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={walletGroups}
            selected={selectedWallets}
            onSelectedChange={setSelectedWallets}
            className="w-full"
          />
        </div>
        <Button className="shrink-0" disabled>
          Scan held NFTs
        </Button>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
          <div className="flex h-12 items-center justify-between gap-2 border-b px-4">
            <h2 className="truncate text-[13px] font-semibold">Held NFT Inventory</h2>
            <div className="relative w-60 shrink-0">
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <label htmlFor="inventory-filter" className="sr-only">
                Filter by token #
              </label>
              <Input
                id="inventory-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by token #"
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex h-12 items-center justify-end gap-2 px-4">
            <Button variant="outline">Refresh</Button>
            <Button variant="outline">Select all</Button>
            <Button variant="outline">Clear</Button>
          </div>

          <Table aria-label="Held NFT inventory">
            <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
              <TableRow>
                <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                  Token
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={1} className="p-0">
                  <EmptyState
                    icon={ScanLine}
                    title="No held NFTs found"
                    description="Scan the collection to load the tokens held across the selected wallets."
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
          <Card className="shrink-0 gap-3 p-4">
            <h2 className="text-[13px] font-semibold">Net proceeds</h2>
            <div className="flex items-end gap-1.5">
              <span className="text-[28px] leading-none font-semibold">0</span>
              <span className="text-muted-foreground text-xs font-medium">WETH</span>
            </div>
            <span className="text-muted-foreground text-[13px]">–</span>
            <Separator />
            <dl className="flex flex-col gap-3">
              {feeRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {row.label}
                  </dt>
                  <dd className="text-[13px] font-medium tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>
            <Separator />
            <dl className="grid grid-cols-3 gap-3">
              {selectionStats.map((stat) => (
                <div key={stat.label} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {stat.label}
                  </dt>
                  <dd className="text-[13px] font-medium tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
            <div className="flex h-12 items-center justify-between gap-2 border-b px-4">
              <h2 className="truncate text-[13px] font-semibold">Active OpenSea Offers</h2>
              <Button variant="ghost" size="icon" aria-label="Refresh offers">
                <RefreshCw />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="m-auto flex flex-col items-center">
                <EmptyState
                  icon={Gavel}
                  title="No active bids"
                  description="No active OpenSea offers found for this collection."
                />
              </div>
            </div>

            <div className="mt-auto shrink-0 border-t p-4">
              <Button className="h-10 w-full">Select NFTs to instant sell</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
