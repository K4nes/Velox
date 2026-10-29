import { useState } from 'react'
import { RefreshCw, ScanLine, Search, Send } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { WalletSelect } from '@/components/wallet-select'
import { walletGroups } from '@/config/wallets'

export function TransferPage() {
  const [collectionUrl, setCollectionUrl] = useState('')
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [destinationWallets, setDestinationWallets] = useState<string[]>([])
  const [address, setAddress] = useState('')
  const [addressTouched, setAddressTouched] = useState(false)

  const trimmedAddress = address.trim()
  const addressInvalid =
    addressTouched &&
    trimmedAddress.length > 0 &&
    !/^0x[0-9a-f]{40}$/i.test(trimmedAddress) &&
    !/^[^\s*]+\.eth$/i.test(trimmedAddress)

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
          aria-labelledby="transfer-wallet-label"
        >
          <span id="transfer-wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={walletGroups}
            selected={selectedWallets}
            onSelectedChange={setSelectedWallets}
            aria-labelledby="transfer-wallet-label"
            className="w-full"
          />
        </div>

        <Button className="shrink-0" disabled>
          <RefreshCw />
          Rescan
        </Button>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold">
                Held NFT Inventory
              </h2>
              <Badge variant="secondary">0 items</Badge>
            </div>
            <div className="relative w-60 shrink-0">
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <label htmlFor="inventory-filter" className="sr-only">
                Filter tokens by name, collection or wallet
              </label>
              <Input
                id="inventory-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by token, name or wallet"
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex h-12 shrink-0 items-center justify-end gap-2 px-4">
            <Button variant="outline">Refresh</Button>
            <Button variant="outline">Select all</Button>
            <Button variant="outline">Clear</Button>
          </div>

          <Table aria-label="Held NFT inventory">
            <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
              <TableRow>
                <TableHead className="w-12 px-3">
                  <Checkbox disabled aria-label="Select all held tokens" />
                </TableHead>
                <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                  NFT
                </TableHead>
                <TableHead className="text-muted-foreground w-[190px] px-3 text-xs font-medium">
                  Source wallet
                </TableHead>
                <TableHead className="text-muted-foreground w-[110px] px-3 text-xs font-medium">
                  Chain
                </TableHead>
                <TableHead className="text-muted-foreground w-[100px] px-3 text-xs font-medium">
                  Floor
                </TableHead>
                <TableHead className="text-muted-foreground w-[150px] px-3 text-xs font-medium">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    icon={ScanLine}
                    title="Nothing scanned yet"
                    description="Pick a collection and the wallets to read, then scan."
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
          <Card className="shrink-0 gap-3 p-4">
            <h2
              id="destination-wallet-label"
              className="text-[13px] font-semibold"
            >
              Destination wallet
            </h2>

            <WalletSelect
              groups={walletGroups}
              selected={destinationWallets}
              onSelectedChange={setDestinationWallets}
              single
              aria-labelledby="destination-wallet-label"
              className="w-full"
            />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="destination-address"
                className="text-xs font-medium"
              >
                Or paste an address
              </label>
              <Input
                id="destination-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onBlur={() => setAddressTouched(true)}
                placeholder="0x… or name.eth"
                aria-invalid={addressInvalid}
                aria-describedby={
                  addressInvalid ? 'destination-address-error' : undefined
                }
              />
              {addressInvalid ? (
                <p
                  id="destination-address-error"
                  className="text-destructive text-xs"
                >
                  Enter a 0x address or a .eth name.
                </p>
              ) : null}
            </div>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
            <div className="flex h-12 shrink-0 items-center border-b px-4">
              <h2 className="truncate text-[13px] font-semibold">Transfer</h2>
            </div>

            <div className="mt-auto shrink-0 border-t p-4">
              <Button className="h-10 w-full" disabled>
                <Send />
                Select NFTs to transfer
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
