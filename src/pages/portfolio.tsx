import { useState } from 'react'
import { Image as ImageIcon, Scan, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { WalletSelect } from '@/components/wallet-select'
import { useWalletGroups } from '@/hooks/use-wallets'
import { cn } from '@/lib/utils'

type Holding = {
  id: string
  name: string
  owner: string
  rank: number
  rankDetail: string
  tier: 'Legendary' | 'Rare' | 'Uncommon' | 'Common'
  floorPrice: string
  floorUsd: string
}

const holdings: Holding[] = []

const tiers = ['All', 'Legendary', 'Rare', 'Uncommon', 'Common'] as const

type Tier = (typeof tiers)[number]

const sortOptions = ['Rarity rank · rarest first', 'Rarity rank · commonest first']

export function PortfolioPage() {
  const [collectionUrl, setCollectionUrl] = useState('')
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [tier, setTier] = useState<Tier>('All')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(sortOptions[0])
  const [picked, setPicked] = useState<string[]>([])
  const { groups } = useWalletGroups()

  const term = query.trim().toLowerCase()
  const searchedHoldings = holdings.filter((holding) =>
    term ? `${holding.name} ${holding.owner}`.toLowerCase().includes(term) : true
  )
  const visibleHoldings = searchedHoldings
    .filter((holding) => tier === 'All' || holding.tier === tier)
    .sort((a, b) =>
      sort === sortOptions[0] ? a.rank - b.rank : b.rank - a.rank
    )

  const allPicked =
    visibleHoldings.length > 0 &&
    visibleHoldings.every((holding) => picked.includes(holding.id))

  const toggleHolding = (id: string) => {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    )
  }

  const toggleAll = () => {
    const visibleIds = visibleHoldings.map((holding) => holding.id)
    setPicked((current) =>
      allPicked
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])]
    )
  }

  const stats = [
    { label: 'Total owned', value: '—', secondary: '—' },
    { label: 'Best rarity', value: '—', secondary: '—' },
    { label: 'Floor value', value: '—', secondary: '—' },
    { label: 'Collection supply', value: '—', secondary: '—' },
    { label: 'Revealed', value: '—', secondary: '—' },
    { label: 'Wallets holding', value: '—', secondary: '—' },
  ]

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="gap-3 p-4 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="collection-url" className="text-xs font-medium">
            Collection URL or slug (OpenSea / Scatter)
          </label>
          <div className="relative">
            <Input
              id="collection-url"
              value={collectionUrl}
              onChange={(event) => setCollectionUrl(event.target.value)}
              placeholder="https://opensea.io/collection/… or https://scatter.art/…"
              className="pr-8"
            />
            {collectionUrl ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear collection URL"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => setCollectionUrl('')}
              >
                <X />
              </Button>
            ) : null}
          </div>
        </div>

        <div
          className="flex flex-col gap-1.5 lg:w-[280px]"
          role="group"
          aria-labelledby="wallets-label"
        >
          <span id="wallets-label" className="text-xs font-medium">
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
          <Scan />
          Scan portfolio
        </Button>
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            <ImageIcon aria-hidden className="text-muted-foreground size-4" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">—</h2>
              <Badge
                variant="outline"
                className="px-1.5 text-[11px] tracking-[0.6px] uppercase"
              >
                —
              </Badge>
              <Badge variant="secondary">—</Badge>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Contract — • Supply — • Revealed —
            </p>
          </div>
        </div>
        <Separator />
      </div>

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="gap-1 px-4">
            <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {stat.label}
            </dt>
            <dd className="flex flex-col gap-0.5">
              <span className="text-card-foreground text-lg font-semibold">
                {stat.value}
              </span>
              <span className="text-muted-foreground text-[11px]">
                {stat.secondary}
              </span>
            </dd>
          </Card>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by tier">
          {tiers.map((option) => {
            const count =
              option === 'All'
                ? searchedHoldings.length
                : searchedHoldings.filter((holding) => holding.tier === option).length
            const active = option === tier

            return (
              <Button
                key={option}
                variant="ghost"
                aria-pressed={active}
                onClick={() => setTier(option)}
                className={cn(
                  'px-2.5 font-medium',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground'
                )}
              >
                {option} ({count})
              </Button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger
              aria-label="Sort held tokens"
              className="w-60 px-3"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {sortOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="flex-1 gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[13px] font-semibold">Held NFT Inventory</h2>
            <Badge variant="secondary">{visibleHoldings.length} items</Badge>
          </div>
          <div className="relative w-60 shrink-0">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <label htmlFor="token-search" className="sr-only">
              Search token
            </label>
            <Input
              id="token-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Token #ID"
              className="pl-8"
            />
          </div>
        </div>
        <Table aria-label="Held NFT inventory">
          <TableHeader>
            <TableRow className="h-11 bg-muted hover:bg-muted">
              <TableHead className="w-12 px-3">
                <Checkbox
                  checked={allPicked}
                  disabled={visibleHoldings.length === 0}
                  aria-label="Select all held tokens"
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                Token
              </TableHead>
              <TableHead className="text-muted-foreground w-[200px] px-3 text-xs font-medium">
                Owner wallet
              </TableHead>
              <TableHead className="text-muted-foreground w-[180px] px-3 text-xs font-medium">
                Rarity rank
              </TableHead>
              <TableHead className="text-muted-foreground w-[130px] px-3 text-xs font-medium">
                Tier
              </TableHead>
              <TableHead className="text-muted-foreground w-[150px] px-3 text-xs font-medium">
                Est. floor
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleHoldings.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground h-24 text-center"
                >
                  No held tokens yet.
                </TableCell>
              </TableRow>
            ) : (
              visibleHoldings.map((holding) => (
                <TableRow key={holding.id} className="h-[60px] hover:bg-transparent">
                  <TableCell className="px-3">
                    <Checkbox
                      checked={picked.includes(holding.id)}
                      aria-label={`Select ${holding.name}`}
                      onCheckedChange={() => toggleHolding(holding.id)}
                    />
                  </TableCell>
                  <TableCell className="px-3">
                    <div className="flex items-center gap-2.5">
                      <div className="bg-muted flex size-7 items-center justify-center rounded-md">
                        <ImageIcon className="text-muted-foreground size-3.5" />
                      </div>
                      <span className="text-sm font-medium">{holding.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 text-[13px]">{holding.owner}</TableCell>
                  <TableCell className="px-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium">
                        #{holding.rank}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {holding.rankDetail}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3">
                    <Badge variant="secondary" className="h-5 px-2">
                      {holding.tier}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium">
                        {holding.floorPrice}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {holding.floorUsd}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
