import { Tags } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { RunStatusCell } from '@/components/run-status-cell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import type { ActiveListingsState, CancelListing } from '@/hooks/run/use-cancel-run'
import type { ListingCurrency } from '@/lib/opensea/index'
import { formatAmount, formatExpiry } from '@/lib/core/format'
import {
  CANCEL_STEP_LABEL,
  CANCEL_STEP_TONE,
} from '@/lib/listings/cancel-run'
import type {
  CancelRunSummary,
  CancelStepState,
} from '@/lib/listings/cancel-run'
import { OrderHashNote } from '@/pages/bulk-sell/order-hash-note'

// An order hash is not a transaction hash, so the asset page is the only page this
// app can send the operator to. The chain slug is the API's own, which is the slug
// OpenSea's own URLs use.
function assetUrl(listing: CancelListing): string {
  return `https://opensea.io/assets/${listing.chain}/${listing.contract}/${listing.tokenId}`
}

function CancelRow({
  listing,
  step,
  currency,
  nowSec,
  selected,
  disabled,
  onToggle,
}: {
  listing: CancelListing
  step: CancelStepState | undefined
  currency: ListingCurrency
  nowSec: number
  selected: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const live =
    step?.status === 'signing' || step?.status === 'cancelling'

  // A listing priced in another currency keeps its amount out of the row: this app
  // never fetched that token's decimals, and a number at the wrong scale reads as
  // a smaller price than the operator listed at.
  const priced =
    listing.priceWei !== null &&
    listing.currency !== null &&
    listing.currency === currency.address.toLowerCase()

  const fillWindow =
    step?.status === 'cancelled' && step.validUntilSec !== null
      ? formatExpiry(step.validUntilSec, nowSec)
      : null

  return (
    <li className="flex items-start gap-2 rounded-[10px] border p-2">
      <Checkbox
        className="mt-0.5"
        aria-label={`Select listing #${listing.tokenId}`}
        checked={selected}
        disabled={disabled}
        onCheckedChange={onToggle}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-[13px] font-medium">
            #{listing.tokenId}
          </span>
          {step ? (
            <RunStatusCell
              tone={CANCEL_STEP_TONE[step.status]}
              label={CANCEL_STEP_LABEL[step.status]}
              live={live}
              error={step.status === 'failed' ? step.error : undefined}
              className="max-w-[110px] items-end text-right"
            />
          ) : null}
        </div>

        <span className="text-muted-foreground text-[11px] tabular-nums">
          {priced
            ? `${formatAmount(listing.priceWei ?? 0n, currency.decimals)} ${currency.symbol} · `
            : ''}
          {listing.label}
        </span>

        <div className="flex items-center justify-between gap-2">
          <OrderHashNote
            orderHash={listing.orderHash}
            openseaUrl={assetUrl(listing)}
            tokenId={listing.tokenId}
          />
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {fillWindow === null
              ? `expires ${formatExpiry(listing.expiresAtSec, nowSec)}`
              : `fills ${fillWindow}`}
          </span>
        </div>
      </div>
    </li>
  )
}

export type CancelRailProps = {
  read: ActiveListingsState
  listings: readonly CancelListing[]
  selectedKeys: readonly string[]
  pending: readonly CancelListing[]
  steps: Map<string, CancelStepState>
  summary: CancelRunSummary | null
  error: string | null
  running: boolean
  currency: ListingCurrency
  onCancel: () => void
  onRetry: () => void
  onToggleOrder: (orderHash: string) => void
  onToggleAll: () => void
}

export function CancelRail({
  read,
  listings,
  selectedKeys,
  pending,
  steps,
  summary,
  error,
  running,
  currency,
  onCancel,
  onRetry,
  onToggleOrder,
  onToggleAll,
}: CancelRailProps) {
  const nowSec = Math.floor(Date.now() / 1000)

  function body() {
    if (read.status === 'loading') {
      return (
        <div className="flex items-center gap-2 p-2">
          <Spinner className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground text-xs">
            Loading active listings…
          </span>
        </div>
      )
    }

    if (read.status === 'failed') {
      return (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-destructive text-xs">
            {read.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={running}
          >
            Retry
          </Button>
        </div>
      )
    }

    if (listings.length === 0) {
      return (
        <div className="m-auto">
          <EmptyState
            icon={Tags}
            title={
              read.status === 'idle'
                ? 'Scan the collection first'
                : 'No active listings'
            }
            description={
              read.status === 'idle'
                ? 'Active listings load once the selected wallets hold tokens from this collection.'
                : 'None of the selected wallets have an active listing on this collection.'
            }
          />
        </div>
      )
    }

    return (
      <ul className="flex flex-col gap-1.5">
        {listings.map((listing) => {
          const cancelled =
            steps.get(listing.orderHash)?.status === 'cancelled'
          return (
            <CancelRow
              key={listing.orderHash}
              listing={listing}
              step={steps.get(listing.orderHash)}
              currency={currency}
              nowSec={nowSec}
              selected={!cancelled && selectedKeys.includes(listing.orderHash)}
              disabled={running || cancelled}
              onToggle={() => onToggleOrder(listing.orderHash)}
            />
          )
        })}
      </ul>
    )
  }

  const selectable = listings.filter(
    (listing) => steps.get(listing.orderHash)?.status !== 'cancelled'
  )
  const selectedVisible = selectable.filter((listing) =>
    selectedKeys.includes(listing.orderHash)
  )
  const headerChecked: boolean | 'indeterminate' =
    selectable.length > 0 && selectedVisible.length === selectable.length
      ? true
      : selectedVisible.length > 0
        ? 'indeterminate'
        : false

  return (
    <Card className="flex max-h-[60svh] min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0 lg:max-h-none">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            aria-label="Select every active listing"
            checked={headerChecked}
            disabled={running || selectable.length === 0}
            onCheckedChange={onToggleAll}
          />
          <h2 className="truncate text-[13px] font-semibold">Active listings</h2>
          <Badge variant="secondary">
            {listings.length} {listings.length === 1 ? 'order' : 'orders'}
          </Badge>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {read.status === 'ready' && read.failed > 0 ? (
          <p className="text-muted-foreground text-[11px]">
            {read.failed} of the selected wallets could not be read
            {read.failure === null ? '' : ` — ${read.failure}`}
          </p>
        ) : null}

        {body()}
      </div>

      <div className="mt-auto shrink-0 border-t p-4">
        {error ? (
          <p role="alert" className="text-destructive mb-2 text-xs">
            {error}
          </p>
        ) : null}

        {summary && summary.total > 0 ? (
          <p className="text-muted-foreground mb-2 text-xs">
            {summary.cancelled} of {summary.total} cancelled
            {summary.failed > 0 ? `, ${summary.failed} failed` : ''}
          </p>
        ) : null}

        <Button
          className="h-10 w-full"
          onClick={onCancel}
          disabled={running || pending.length === 0}
        >
          {running ? (
            <>
              <Spinner data-icon="inline-start" />
              Cancelling…
            </>
          ) : (
            `Cancel ${pending.length} listing${pending.length === 1 ? '' : 's'}`
          )}
        </Button>
      </div>
    </Card>
  )
}
