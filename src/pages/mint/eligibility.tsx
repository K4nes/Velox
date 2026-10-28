import { useState } from 'react'
import { Eye, RefreshCw, Trash2 } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

type Snapshot = {
  id: string
  title: string
  status: 'Upcoming' | 'Live' | 'Ended'
  marketplace: string
  chain: string
  date: string
}

const snapshots: Snapshot[] = [
  {
    id: 'snap-1',
    title: 'NFT Title',
    status: 'Upcoming',
    marketplace: 'OpenSea',
    chain: 'Ethereum',
    date: '12 Oct 2026, 14:30',
  },
  {
    id: 'snap-2',
    title: 'NFT Title',
    status: 'Live',
    marketplace: 'OpenSea',
    chain: 'Ethereum',
    date: '13 Oct 2026, 09:00',
  },
  {
    id: 'snap-3',
    title: 'NFT Title',
    status: 'Ended',
    marketplace: 'OpenSea',
    chain: 'Ethereum',
    date: '10 Oct 2026, 23:15',
  },
]

export function MintEligibilityPage() {
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Tabs defaultValue="check" className="flex flex-1 flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="check" className="focus-visible:ring-[1px]">
            Check Eligible
          </TabsTrigger>
          <TabsTrigger value="snapshot" className="focus-visible:ring-[1px]">
            Snapshot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="flex flex-1 flex-col gap-4">
          <Card className="gap-3 p-4 lg:flex-row lg:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label
                htmlFor="eligibility-collection-url"
                className="text-xs font-medium"
              >
                Collection URL or slug (OpenSea / Scatter)
              </label>
              <Input
                id="eligibility-collection-url"
                placeholder="https://opensea.io/collection/… or https://scatter.art/…"
              />
            </div>
            <div
              className="flex flex-col gap-1.5 lg:w-[280px]"
              role="group"
              aria-labelledby="eligibility-wallet-label"
            >
              <span id="eligibility-wallet-label" className="text-xs font-medium">
                Wallet
              </span>
              <WalletSelect
                groups={walletGroups}
                selected={selectedWallets}
                onSelectedChange={setSelectedWallets}
                aria-labelledby="eligibility-wallet-label"
                className="w-full"
              />
            </div>
            <Button className="shrink-0">Check</Button>
          </Card>
          <Card className="flex flex-1 flex-col gap-3 p-4">
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>NFT Title</span>
              <span>Label Marketplace</span>
              <span>Chain</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Table>
                <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
                  <TableRow>
                    <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                      #
                    </TableHead>
                    <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                      Wallet Profile
                    </TableHead>
                    <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                      Address
                    </TableHead>
                    <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                      Mint Stage
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={4}
                      className="text-muted-foreground h-24 text-center"
                    >
                      No data yet
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="snapshot" className="flex flex-1 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {snapshots.map((snapshot) => (
              <Card key={snapshot.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-[13px] font-semibold">{snapshot.title}</CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        snapshot.status === 'Live'
                          ? 'border-success/30 bg-success/10 text-success'
                          : snapshot.status === 'Upcoming'
                            ? 'border-warning/30 bg-warning/10 text-warning'
                            : 'text-muted-foreground'
                      }
                    >
                      {snapshot.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <span>Marketplace</span>
                    <span className="text-foreground">{snapshot.marketplace}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Chain</span>
                    <span className="text-foreground">{snapshot.chain}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Date</span>
                    <span className="text-foreground">{snapshot.date}</span>
                  </div>
                </CardContent>
                <CardFooter className="justify-between gap-2">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <RefreshCw />
                      Refresh
                    </Button>
                    <Button size="sm">
                      <Eye />
                      View Snapshot
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Delete snapshot"
                    className="hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

        </TabsContent>
      </Tabs>
    </div>
  )
}
