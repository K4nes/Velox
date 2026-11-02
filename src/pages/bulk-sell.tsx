import { useState } from 'react'
import { PackageOpen, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WalletSelect } from '@/components/wallet-select'
import { useWalletGroups } from '@/hooks/use-wallets'

const durations = [
  '1 day',
  '3 days',
  '7 days',
  '30 days (1 month)',
  '90 days (3 months)',
] as const

type Duration = (typeof durations)[number]
type RailTab = 'create' | 'cancel'

function isDuration(value: string): value is Duration {
  return (durations as readonly string[]).includes(value)
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function ValueBox({ label, caption }: { label: string; caption: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] bg-muted p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-lg font-semibold">0 ETH</span>
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  )
}

function BulkSellRail() {
  const [tab, setTab] = useState<RailTab>('create')
  const [price, setPrice] = useState('')
  const [duration, setDuration] = useState<Duration>('30 days (1 month)')

  return (
    <Card className="flex w-full shrink-0 flex-col gap-0 overflow-hidden py-0 lg:w-[300px]">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === 'create' || value === 'cancel') {
            setTab(value)
          }
        }}
        className="flex flex-1 flex-col gap-0"
      >
        <div className="px-4 pt-4 pb-2">
          <TabsList className="w-full" aria-label="Listing actions">
            <TabsTrigger value="create">Create listings</TabsTrigger>
            <TabsTrigger value="cancel">Cancel listings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="create" className="flex flex-col px-4 pt-2 pb-4">
          <div id="rail-create" className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="list-price" className="text-xs font-medium">
                Price per item · ETH
              </label>
              <Input
                id="list-price"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0.0000"
              />
              <p className="text-xs text-muted-foreground">
                Applies to every token you list. Totals appear after the scan.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <span id="list-duration-label" className="text-xs font-medium">
                Duration
              </span>
              <Select
                value={duration}
                onValueChange={(value) => {
                  if (isDuration(value)) {
                    setDuration(value)
                  }
                }}
              >
                <SelectTrigger aria-labelledby="list-duration-label" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  {durations.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <p className="text-[13px] font-semibold">Order summary</p>

            <SummaryRow label="Items to list" value="0" />
            <SummaryRow label="Price" value="0 ETH" />
            <SummaryRow label="Marketplace fee" value="-0 ETH" />
            <SummaryRow label="Royalty fee" value="-0 ETH" />

            <ValueBox label="Net proceeds" caption="after marketplace & royalty fees" />
          </div>
        </TabsContent>

        <TabsContent value="cancel" className="flex flex-col px-4 pt-2 pb-4">
          <div id="rail-cancel" className="flex flex-1 flex-col gap-4">
            <p className="text-muted-foreground">
              Removes the selected listings from Seaport. Tokens stay in your wallet and
              can be relisted.
            </p>

            <Separator />

            <p className="text-[13px] font-semibold">Cancel summary</p>

            <SummaryRow label="Listings to cancel" value="0" />
            <SummaryRow label="Ask value withdrawn" value="0 ETH" />

            <ValueBox label="Value withdrawn" caption="across 0 active listings" />
          </div>
        </TabsContent>

        <div className="mt-auto shrink-0 border-t p-4">
          <Button
            aria-controls={tab === 'create' ? 'rail-create' : 'rail-cancel'}
            className="h-10 w-full"
          >
            {tab === 'create' ? 'Create listings' : 'Cancel listings'}
          </Button>
        </div>
      </Tabs>
    </Card>
  )
}

export function BulkSellPage() {
  const [collectionUrl, setCollectionUrl] = useState('')
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const { groups } = useWalletGroups()

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
            placeholder="https://opensea.io/collection/… or https://scatter.art/…"
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
        <Card className="min-w-0 gap-0 overflow-hidden py-0 lg:flex-1">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <h2 className="truncate text-[13px] font-semibold">Inventory</h2>
            <div className="relative w-60">
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <label htmlFor="token-filter" className="sr-only">
                Filter tokens by token number
              </label>
              <Input
                id="token-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by token #"
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center p-4">
            <div className="flex flex-col items-center gap-1.5 p-8 text-center">
              <PackageOpen aria-hidden className="text-muted-foreground size-6" />
              <p className="text-sm">No tokens loaded yet</p>
              <p className="text-muted-foreground text-xs">
                Scan the collection to load the tokens held in the selected wallet scope.
              </p>
            </div>
          </div>
        </Card>

        <BulkSellRail />
      </div>
    </div>
  )
}
