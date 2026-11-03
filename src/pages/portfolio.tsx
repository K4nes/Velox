import { useMemo, useState } from 'react'
import { Image as ImageIcon, Scan, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
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
import { usePortfolioScan } from '@/hooks/use-portfolio-scan'
import { useWalletGroups } from '@/hooks/use-wallets'
import {
  countRarityBands,
  portfolioStats,
  rarityBandOf,
  searchHoldings,
  sortHoldings,
} from '@/lib/portfolio'
import type {
  HoldingSort,
  RarityBandKey,
  ScanningHolding,
} from '@/lib/portfolio'
import { cn } from '@/lib/utils'

const BANDS: readonly { key: RarityBandKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'top1', label: 'Top 1%' },
  { key: 'top10', label: '1-10%' },
  { key: 'top33', label: '10-33%' },
  { key: 'rest', label: 'Rest' },
  { key: 'no-rank', label: 'No rank' },
]

const SORTS: readonly { value: HoldingSort; label: string }[] = [
  { value: 'rarest', label: 'Rarity rank · rarest first' },
  { value: 'commonest', label: 'Rarity rank · commonest first' },
]

function shortenAddress(address: string): string {
  return address.length > 10
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address
}

function formatPercent(value: number): string {
  const digits = value < 1 ? 2 : value < 10 ? 1 : 0
  return `${value.toFixed(digits).replace(/\.0+$/, '')}%`
}

function formatAmount(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

function TokenImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
        <ImageIcon aria-hidden className="text-muted-foreground size-3.5" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="bg-muted size-7 shrink-0 rounded-md object-cover"
    />
  )
}

function RarityRank({ row }: { row: ScanningHolding }) {
  switch (row.rarity.status) {
    case 'ranked':
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">#{row.rarity.rank}</span>
          <span className="text-muted-foreground text-[11px]">
            {row.rarity.topPercent === null
              ? '—'
              : `Top ${formatPercent(row.rarity.topPercent)}`}
          </span>
        </div>
      )
    case 'pending':
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">—</span>
          <span className="text-muted-foreground text-[11px]">Loading…</span>
        </div>
      )
    case 'unranked':
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">—</span>
          <span className="text-muted-foreground text-[11px]">No rank</span>
        </div>
      )
    case 'missing':
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">—</span>
          <span className="text-muted-foreground text-[11px]">Not found</span>
        </div>
      )
    case 'failed':
      return (
        <div className="flex flex-col gap-0.5" title={row.rarity.message}>
          <span className="text-[13px] font-medium">—</span>
          <span className="text-muted-foreground text-[11px]">Unavailable</span>
        </div>
      )
  }
}

export function PortfolioPage() {
  const scan = usePortfolioScan()
  const { groups, error: walletsError } = useWalletGroups()
  const [query, setQuery] = useState('')
  const [band, setBand] = useState<RarityBandKey>('all')
  const [sort, setSort] = useState<HoldingSort>('rarest')

  const snapshot = scan.state.status === 'scanning' ? scan.state.snapshot : null
  const result = scan.state.status === 'ready' ? scan.state.result : null
  const collection = result?.collection ?? snapshot?.collection ?? null
  const stats = result?.stats ?? snapshot?.stats ?? null
  const ethUsd = result?.ethUsd ?? snapshot?.ethUsd ?? null
  const wallets = result?.wallets ?? snapshot?.wallets ?? []
  const collapsed = result?.collapsed ?? snapshot?.collapsed ?? []
  const holdings = result?.holdings ?? snapshot?.holdings ?? []
  const maxRank = collection?.rarity?.maxRank ?? null

  const searched = useMemo(
    () => searchHoldings(holdings, query),
    [holdings, query]
  )
  const bands = useMemo(
    () => countRarityBands(searched, maxRank),
    [searched, maxRank]
  )
  const visible = useMemo(
    () =>
      sortHoldings(
        band === 'all'
          ? searched
          : searched.filter((row) => rarityBandOf(row, maxRank) === band),
        sort
      ),
    [searched, band, maxRank, sort]
  )
  const summary = useMemo(
    () =>
      portfolioStats({
        holdings,
        wallets,
        supply: collection?.totalSupply ?? null,
        floor: stats?.floorPrice ?? null,
        floorSymbol: stats?.floorSymbol ?? '',
        ethUsd,
      }),
    [
      holdings,
      wallets,
      collection?.totalSupply,
      stats?.floorPrice,
      stats?.floorSymbol,
      ethUsd,
    ]
  )

  const rarityLabel = collection
    ? collection.rarity
      ? ['OpenRarity', collection.rarity.strategyVersion]
          .filter(Boolean)
          .join(' ')
      : 'No rarity index'
    : '—'
  const contractLabel = collection
    ? shortenAddress(collection.contractAddress)
    : '—'
  const supplyLabel =
    collection?.totalSupply != null
      ? collection.totalSupply.toLocaleString('en-US')
      : '—'
  const floorLabel =
    stats?.floorPrice != null
      ? `${formatAmount(stats.floorPrice)} ${stats.floorSymbol}`.trim()
      : '—'

  const failedWallets = wallets.filter(
    (wallet) => wallet.error !== null
  ).length
  const walletParts = [`${wallets.length} scanned`]
  if (failedWallets > 0) walletParts.push(`${failedWallets} failed`)
  if (collapsed.length > 0) walletParts.push(`${collapsed.length} duplicate`)

  const rankParts = [
    summary.pending > 0 ? `${summary.pending} pending` : null,
    summary.unranked > 0 ? `${summary.unranked} unranked` : null,
    summary.unavailable > 0 ? `${summary.unavailable} unavailable` : null,
  ].filter((part): part is string => part !== null)

  const totalFloor =
    stats?.floorPrice != null ? summary.units * stats.floorPrice : null
  const floorValue =
    totalFloor !== null
      ? `${formatAmount(totalFloor)} ${stats?.floorSymbol ?? ''}`.trim()
      : '—'
  const floorSecondary =
    totalFloor !== null && stats?.floorSymbol === 'ETH' && ethUsd !== null
      ? `≈ $${Math.round(totalFloor * ethUsd).toLocaleString('en-US')}`
      : 'Collection floor'

  const tiles = [
    {
      label: 'Total owned',
      value: summary.units.toLocaleString('en-US'),
      secondary: `${summary.rows.toLocaleString('en-US')} tokens`,
    },
    {
      label: 'Best rarity',
      value: summary.bestRank !== null ? `#${summary.bestRank}` : '—',
      secondary:
        summary.bestTopPercent !== null
          ? `Top ${formatPercent(summary.bestTopPercent)}`
          : 'No ranked tokens',
    },
    {
      label: 'Floor value',
      value: floorValue,
      secondary: floorSecondary,
    },
    {
      label: 'Ranked',
      value: `${summary.ranked}/${summary.rows}`,
      secondary: rankParts.length > 0 ? rankParts.join(' · ') : 'All ranked',
    },
    {
      label: 'Collection supply',
      value: supplyLabel,
      secondary: rarityLabel,
    },
    {
      label: 'Wallets holding',
      value: summary.walletsHolding.toLocaleString('en-US'),
      secondary: walletParts.join(' · '),
    },
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
              value={scan.url}
              onChange={(event) => scan.changeUrl(event.target.value)}
              placeholder="https://opensea.io/collection/… or https://scatter.art/…"
              className="pr-8"
              disabled={scan.running}
            />
            {scan.url ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear collection URL"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => scan.changeUrl('')}
                disabled={scan.running}
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
            selected={scan.selectedWallets}
            onSelectedChange={scan.changeWallets}
            disabled={scan.running}
            aria-labelledby="wallets-label"
            className="w-full"
          />
          {walletsError ? (
            <p role="alert" className="text-destructive text-xs">
              Wallet list unavailable. {walletsError}
            </p>
          ) : null}
        </div>

        <Button
          className="shrink-0"
          onClick={() => void scan.scan()}
          disabled={
            scan.running ||
            !scan.url.trim() ||
            scan.selectedWallets.length === 0
          }
        >
          {scan.running ? <Spinner data-icon="inline-start" /> : <Scan />}
          Scan portfolio
        </Button>
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
            {collection?.imageUrl ? (
              <img
                src={collection.imageUrl}
                alt=""
                className="size-9 rounded-lg object-cover"
              />
            ) : (
              <ImageIcon aria-hidden className="text-muted-foreground size-4" />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">
                {collection ? collection.name || collection.slug : '—'}
              </h2>
              <Badge
                variant="outline"
                className="px-1.5 text-[11px] tracking-[0.6px] uppercase"
              >
                {collection?.chain ?? '—'}
              </Badge>
              <Badge variant="secondary">{rarityLabel}</Badge>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Contract {contractLabel} • Supply {supplyLabel} • Floor{' '}
              {floorLabel}
            </p>
          </div>
        </div>
        <Separator />
      </div>

      <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.label} className="gap-1 px-4">
            <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {tile.label}
            </dt>
            <dd className="flex flex-col gap-0.5">
              <span className="text-card-foreground text-lg font-semibold">
                {tile.value}
              </span>
              <span className="text-muted-foreground text-[11px]">
                {tile.secondary}
              </span>
            </dd>
          </Card>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by rarity band"
        >
          {BANDS.map((option) => {
            const active = option.key === band

            return (
              <Button
                key={option.key}
                variant="ghost"
                aria-pressed={active}
                onClick={() => setBand(option.key)}
                className={cn(
                  'px-2.5 font-medium',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground'
                )}
              >
                {option.label} ({bands[option.key]})
              </Button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as HoldingSort)}
          >
            <SelectTrigger aria-label="Sort held tokens" className="w-60 px-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {SORTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="flex-1 gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[13px] font-semibold">
              Held NFT Inventory
            </h2>
            <Badge variant="secondary">{visible.length} items</Badge>
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
              <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                Token
              </TableHead>
              <TableHead className="text-muted-foreground w-[200px] px-3 text-xs font-medium">
                Owner wallet
              </TableHead>
              <TableHead className="text-muted-foreground w-[180px] px-3 text-xs font-medium">
                Rarity rank
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={3}
                  className={cn(
                    'h-24 text-center',
                    scan.tableState.status === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  )}
                >
                  {scan.tableState.status === 'ready'
                    ? 'No held tokens match the filters.'
                    : scan.tableState.message}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((holding) => (
                <TableRow
                  key={holding.id}
                  className="h-[60px] hover:bg-transparent"
                >
                  <TableCell className="px-3">
                    <div className="flex items-center gap-2.5">
                      <TokenImage
                        src={holding.imageUrl}
                        alt={holding.name || `#${holding.tokenId}`}
                      />
                      {holding.openseaUrl ? (
                        <a
                          href={holding.openseaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium hover:underline"
                        >
                          {holding.name || `#${holding.tokenId}`}
                        </a>
                      ) : (
                        <span className="text-sm font-medium">
                          {holding.name || `#${holding.tokenId}`}
                        </span>
                      )}
                      {holding.quantity > 1 ? (
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[11px]"
                        >
                          ×{holding.quantity}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-3">
                    <div
                      className="flex flex-col gap-0.5"
                      title={holding.owner.address}
                    >
                      <span className="text-[13px] font-medium">
                        {holding.owner.label}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {shortenAddress(holding.owner.address)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3">
                    <RarityRank row={holding} />
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
