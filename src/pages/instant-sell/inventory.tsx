import { PackageOpen, Search } from 'lucide-react'

import { BodyMessage } from '@/components/body-message'
import { RunStatusCell } from '@/components/run-status-cell'
import { TokenImage } from '@/components/token-image'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { HoldingsScanState } from '@/hooks/use-holdings-scan'
import { formatAmount, formatExpiry, shortAddress } from '@/lib/format'
import type { CollectionOffer, UncoveredReason } from '@/lib/instant-sell'
import type { HeldToken } from '@/lib/holdings'
import { SELL_STEP_LABEL, SELL_STEP_TONE } from '@/lib/sell-run'
import type { SellStepState } from '@/lib/sell-run'

export type InventoryBlock =
  | UncoveredReason
  | 'sub-unit'
  | 'loading'
  | 'unavailable'
  | 'sold'

export type InventoryRow = {
  token: HeldToken
  best: CollectionOffer | null
  assigned: CollectionOffer | null
  blocked: InventoryBlock | null
  selected: boolean
  status: SellStepState | undefined
}

function BidCell({
  row,
  currencySymbol,
  now,
}: {
  row: InventoryRow
  currencySymbol: string
  now: number
}) {
  if (row.blocked === 'sub-unit') {
    return <span className="text-muted-foreground text-xs">Below 1 unit</span>
  }

  if (row.blocked === 'no-bid') {
    return (
      <span className="text-muted-foreground text-xs">
        No {currencySymbol} bid
      </span>
    )
  }

  if (row.blocked === 'loading') {
    return <span className="text-muted-foreground text-xs">Loading bids…</span>
  }

  if (row.blocked === 'unavailable') {
    return (
      <span className="text-muted-foreground text-xs">Bids unavailable</span>
    )
  }

  if (row.blocked === 'sold') {
    return <span className="text-primary text-xs font-medium">Sold</span>
  }

  if (row.blocked === 'depth-exhausted') {
    return (
      <span className="text-muted-foreground text-xs">No bid depth left</span>
    )
  }

  const offer = row.selected ? row.assigned : row.best
  if (!offer) {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  const expiry = formatExpiry(offer.expiresAtSec, now)

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] font-medium tabular-nums">
        {formatAmount(offer.netWei, offer.currency.decimals)}{' '}
        {offer.currency.symbol}
      </span>
      <span className="text-muted-foreground text-[11px]">
        {row.selected
          ? expiry === 'expired'
            ? 'expired'
            : `expires ${expiry}`
          : 'best bid'}
      </span>
    </div>
  )
}

function StatusCell({ step }: { step: SellStepState | undefined }) {
  if (!step) {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  const live =
    step.status === 'preparing' ||
    step.status === 'approving' ||
    step.status === 'sending' ||
    step.status === 'confirming'
  const hash =
    step.status === 'confirming' || step.status === 'sold' ? step.txHash : null

  return (
    <RunStatusCell
      tone={SELL_STEP_TONE[step.status]}
      label={SELL_STEP_LABEL[step.status]}
      live={live}
      note={hash ? `${hash.slice(0, 8)}…` : undefined}
      error={step.status === 'failed' ? step.error : undefined}
    />
  )
}

export function Inventory({
  state,
  rows,
  totalRows,
  query,
  onQueryChange,
  allVisibleSelected,
  someVisibleSelected,
  onToggleVisible,
  running,
  onToggleToken,
  currencySymbol,
}: {
  state: HoldingsScanState
  rows: readonly InventoryRow[]
  totalRows: number
  query: string
  onQueryChange: (value: string) => void
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  onToggleVisible: () => void
  running: boolean
  onToggleToken: (key: string) => void
  currencySymbol: string
}) {
  const now = Math.floor(Date.now() / 1000)

  const failedWallets =
    state.status === 'ready'
      ? state.scans.filter((scan) => scan.error !== null)
      : []

  function body() {
    if (state.status === 'failed') {
      return (
        <BodyMessage
          icon={PackageOpen}
          title={state.message}
          tone="text-destructive"
        />
      )
    }

    if (state.status === 'scanning') {
      return (
        <div className="flex flex-1 items-center justify-center gap-2 p-8">
          <Spinner className="text-muted-foreground size-4" />
          <p className="text-muted-foreground text-sm">Scanning collection…</p>
        </div>
      )
    }

    if (totalRows > 0 && rows.length === 0) {
      return (
        <BodyMessage
          icon={PackageOpen}
          title="No tokens match the filter"
          description="Clear the filter to see every held token again."
        />
      )
    }

    if (state.status === 'ready' && totalRows === 0) {
      if (failedWallets.length > 0) {
        return (
          <BodyMessage
            icon={PackageOpen}
            title={`${failedWallets.length} of ${state.scans.length} wallets could not be read`}
            description={failedWallets[0]?.error ?? ''}
            tone="text-destructive"
          />
        )
      }

      return (
        <BodyMessage
          icon={PackageOpen}
          title="No held NFTs found"
          description="None of the selected wallets hold a token from this collection."
        />
      )
    }

    if (totalRows === 0) {
      return (
        <BodyMessage
          icon={PackageOpen}
          title="No tokens loaded yet"
          description="Scan the collection to load the tokens held in the selected wallet scope."
        />
      )
    }

    return (
      <Table aria-label="Held NFT inventory">
        <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
          <TableRow>
            <TableHead className="w-10 pl-4">
              <Checkbox
                aria-label="Select every token in this view"
                checked={
                  allVisibleSelected
                    ? true
                    : someVisibleSelected
                      ? 'indeterminate'
                      : false
                }
                disabled={running}
                onCheckedChange={onToggleVisible}
              />
            </TableHead>
            <TableHead className="text-muted-foreground px-3 text-xs font-medium">
              Token
            </TableHead>
            <TableHead className="text-muted-foreground w-[200px] px-3 text-xs font-medium">
              Wallet
            </TableHead>
            <TableHead className="text-muted-foreground w-[200px] px-3 text-xs font-medium">
              Bid
            </TableHead>
            <TableHead className="text-muted-foreground w-[240px] px-3 text-xs font-medium">
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const subUnit = Math.floor(row.token.quantity) < 1
            const disabled =
              running ||
              row.blocked === 'sold' ||
              (!row.selected && (subUnit || row.blocked !== null))
            const title =
              row.blocked === 'sold'
                ? 'This token was sold'
                : subUnit
                  ? 'Balance is below one whole unit, so this token cannot be sold'
                  : !row.selected && row.blocked === 'no-bid'
                    ? 'No collection bid for this token'
                    : !row.selected && row.blocked === 'depth-exhausted'
                      ? 'No bid depth left'
                      : !row.selected && row.blocked === 'loading'
                        ? 'Offers are still loading'
                        : !row.selected && row.blocked === 'unavailable'
                          ? 'Offers could not be loaded'
                          : undefined

            return (
              <TableRow key={row.token.key}>
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={`Select token #${row.token.tokenId}`}
                    checked={row.selected}
                    disabled={disabled}
                    title={title}
                    onCheckedChange={() => onToggleToken(row.token.key)}
                  />
                </TableCell>
                <TableCell className="px-3">
                  <div className="flex items-center gap-2.5">
                    <TokenImage
                      src={row.token.imageUrl}
                      alt={row.token.name || `Token #${row.token.tokenId}`}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="max-w-[220px] truncate text-[13px] font-medium">
                        {row.token.name || `#${row.token.tokenId}`}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        #{row.token.tokenId}
                      </span>
                    </div>
                    {row.token.quantity !== 1 ? (
                      <Badge variant="secondary">{`${row.token.quantity}×`}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="px-3">
                  <div className="flex flex-col">
                    <span className="max-w-[180px] truncate text-[13px]">
                      {row.token.owner.label}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {shortAddress(row.token.owner.address)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="px-3">
                  <BidCell
                    row={row}
                    currencySymbol={currencySymbol}
                    now={now}
                  />
                </TableCell>
                <TableCell className="px-3">
                  <StatusCell step={row.status} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  return (
    <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="truncate text-[13px] font-semibold">Held NFT Inventory</h2>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary">
            {totalRows} {totalRows === 1 ? 'item' : 'items'}
          </Badge>
          <div className="relative w-60">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <label htmlFor="instant-token-filter" className="sr-only">
              Filter tokens by token number
            </label>
            <Input
              id="instant-token-filter"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Filter by token #"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      {body()}
    </Card>
  )
}
