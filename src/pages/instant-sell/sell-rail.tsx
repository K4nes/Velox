import { Gavel, RefreshCw } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { SummaryRow } from '@/components/summary-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import type { OffersState } from '@/hooks/data/use-collection-offers'
import { formatAmount, formatExpiry } from '@/lib/core/format'
import type {
  OfferLadder,
  SalesPlan,
} from '@/lib/offers/instant-sell'
import type { SellRunSummary } from '@/lib/offers/sell-run'
import { cn } from '@/lib/utils'

function formatAge(sec: number, now: number): string {
  const diff = Math.max(0, now - sec)
  if (diff < 60) return 'just now'
  if (diff >= 3_600) return `${Math.floor(diff / 3_600)}h ago`
  return `${Math.floor(diff / 60)}m ago`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
    </div>
  )
}

export function SellRail({
  offers,
  ladders,
  ladder,
  currency,
  onCurrencyChange,
  onRefresh,
  plan,
  selectedCount,
  summary,
  error,
  blockedReason,
  running,
  onAccept,
}: {
  offers: OffersState
  ladders: readonly OfferLadder[]
  ladder: OfferLadder | null
  currency: string | null
  onCurrencyChange: (address: string) => void
  onRefresh: () => void
  plan: SalesPlan
  selectedCount: number
  summary: SellRunSummary | null
  error: string | null
  blockedReason: string | null
  running: boolean
  onAccept: () => void
}) {
  const now = Math.floor(Date.now() / 1000)
  const symbol = plan.currency?.symbol ?? 'ETH'
  const decimals = plan.currency?.decimals ?? 18
  const runSymbol = summary?.symbol ?? symbol
  const runDecimals = summary?.decimals ?? decimals
  const covered = plan.targets.length
  const activeAddress = ladder?.currency.address ?? currency
  const average = covered > 0 ? plan.totals.netWei / BigInt(covered) : 0n
  const earliest =
    plan.expiresAtSec !== null
      ? formatExpiry(plan.expiresAtSec, now)
      : null

  return (
    <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
      <Card className="shrink-0 gap-3 p-4">
        <h2 className="text-[13px] font-semibold">Net proceeds</h2>

        <div className="flex items-end gap-1.5">
          <span className="text-[28px] leading-none font-semibold tabular-nums">
            {formatAmount(plan.totals.netWei, decimals)}
          </span>
          <span className="text-muted-foreground text-xs font-medium">
            {symbol}
          </span>
        </div>

        <span className="text-muted-foreground text-[13px]">
          {earliest === null
            ? '—'
            : earliest === 'expired'
              ? 'expired'
              : `earliest expiry ${earliest}`}
        </span>

        <Separator />

        <div className="flex flex-col gap-3">
          <SummaryRow
            label="Gross proceeds"
            value={`${formatAmount(plan.totals.grossWei, decimals)} ${symbol}`}
          />
          <SummaryRow
            label="Fees"
            value={
              plan.totals.feeWei > 0n
                ? `-${formatAmount(plan.totals.feeWei, decimals)} ${symbol}`
                : `0 ${symbol}`
            }
          />
        </div>

        <Separator />

        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Selected" value={String(selectedCount)} />
          <Stat label="Covered" value={String(covered)} />
          <Stat label="Avg bid" value={formatAmount(average, decimals)} />
        </dl>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <h2 className="truncate text-[13px] font-semibold">
            Active OpenSea Offers
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh offers"
            onClick={onRefresh}
            disabled={running}
          >
            <RefreshCw
              className={
                offers.status === 'loading' ? 'animate-spin' : undefined
              }
            />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {offers.status !== 'idle' && offers.book ? (
            <p className="text-muted-foreground text-[11px]">
              as of {formatAge(offers.book.fetchedAtSec, now)}
              {offers.book.truncated ? ' · first 1,000 bids' : ''}
            </p>
          ) : null}

          {ladders.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              {ladders.map((entry) => {
                const top = entry.offers[0]
                const active = entry.currency.address === activeAddress
                return (
                  <Button
                    key={entry.currency.address}
                    type="button"
                    variant={active ? 'secondary' : 'outline'}
                    aria-pressed={active}
                    className="h-auto flex-col items-start gap-0 px-2 py-1.5"
                    disabled={running}
                    onClick={() => onCurrencyChange(entry.currency.address)}
                  >
                    <span className="text-xs font-medium">
                      {entry.currency.symbol}
                    </span>
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                      {formatAmount(top.netWei, entry.currency.decimals)}
                    </span>
                  </Button>
                )
              })}
            </div>
          ) : null}

          {offers.status === 'failed' ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-destructive text-xs">
                {offers.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={running}
              >
                Retry
              </Button>
            </div>
          ) : null}

          {offers.status === 'loading' && offers.book === null ? (
            <div className="flex items-center gap-2 p-2">
              <Spinner className="text-muted-foreground size-3.5" />
              <span className="text-muted-foreground text-xs">
                Loading offers…
              </span>
            </div>
          ) : ladder ? (
            <div
              className={cn(
                'flex flex-col gap-1.5',
                offers.status === 'loading' && 'opacity-60'
              )}
            >
              {ladder.offers.map((offer) => {
                const expiry = formatExpiry(offer.expiresAtSec, now)
                return (
                  <div
                    key={offer.id}
                    className="flex items-center justify-between gap-2 rounded-[10px] border p-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium tabular-nums">
                        {formatAmount(offer.netWei, ladder.currency.decimals)}{' '}
                        {ladder.currency.symbol}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {expiry === 'expired' ? 'expired' : `expires ${expiry}`}
                      </span>
                    </div>
                    <Badge variant="secondary">×{offer.remaining}</Badge>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="m-auto">
              <EmptyState
                icon={Gavel}
                title={
                  offers.status === 'idle'
                    ? 'Scan a collection to load offers'
                    : 'No active collection offers'
                }
                description={
                  offers.status === 'idle'
                    ? 'Pick a collection and scan the wallets that hold it.'
                    : 'No collection offers found for this collection.'
                }
              />
            </div>
          )}
        </div>

        <div className="mt-auto shrink-0 border-t p-4">
          {error ? (
            <p role="alert" className="text-destructive mb-2 text-xs">
              {error}
            </p>
          ) : null}

          {summary && summary.total > 0 ? (
            <p className="text-muted-foreground mb-2 text-xs">
              {summary.sold} of {summary.total} sold
              {' · '}
              {formatAmount(summary.netWei, runDecimals)} {runSymbol}
              {summary.failed > 0 ? ` · ${summary.failed} failed` : ''}
            </p>
          ) : null}

          {plan.uncovered.size > 0 && ladder !== null ? (
            <p className="text-muted-foreground mb-2 text-xs">
              {plan.uncovered.size} selected{' '}
              {plan.uncovered.size === 1 ? 'token has' : 'tokens have'} no bid
              in {symbol}
            </p>
          ) : null}

          <Button
            className="h-10 w-full"
            onClick={onAccept}
            disabled={running || blockedReason !== null}
          >
            {running ? (
              <>
                <Spinner data-icon="inline-start" />
                Accepting offers…
              </>
            ) : (
              `Accept ${covered} offer${covered === 1 ? '' : 's'}`
            )}
          </Button>

          {!running && blockedReason !== null ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {blockedReason}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
