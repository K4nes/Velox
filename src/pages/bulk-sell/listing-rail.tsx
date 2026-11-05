import { formatUnits } from 'viem'

import { SummaryRow } from '@/components/summary-row'
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
import { Spinner } from '@/components/ui/spinner'
import { listingDurationOptions } from '@/lib/listing-plan'
import type { PlanFeeTotals } from '@/lib/listing-plan'
import type { RunSummary } from '@/lib/listing-run'

function formatAmount(amount: bigint, decimals: number): string {
  const [whole, fraction] = formatUnits(amount, decimals).split('.')
  const trimmed = (fraction ?? '').slice(0, 6).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

export function ListingRail({
  price,
  onPriceChange,
  durationDays,
  onDurationChange,
  itemCount,
  symbol,
  decimals,
  estimatedTotals,
  summary,
  error,
  blockedReason,
  running,
  onCreate,
}: {
  price: string
  onPriceChange: (value: string) => void
  durationDays: number
  onDurationChange: (days: number) => void
  itemCount: number
  symbol: string
  decimals: number
  estimatedTotals: PlanFeeTotals
  summary: RunSummary | null
  error: string | null
  blockedReason: string | null
  running: boolean
  onCreate: () => void
}) {
  return (
    <Card className="flex w-full shrink-0 flex-col gap-0 overflow-hidden py-0 lg:w-[300px]">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="list-price" className="text-xs font-medium">
            Price per item · {symbol}
          </label>
          <Input
            id="list-price"
            inputMode="decimal"
            value={price}
            onChange={(event) => onPriceChange(event.target.value)}
            placeholder="0.0000"
            disabled={running}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="list-duration-label" className="text-xs font-medium">
            Duration
          </span>
          <Select
            value={String(durationDays)}
            onValueChange={(value) => onDurationChange(Number(value))}
          >
            <SelectTrigger
              aria-labelledby="list-duration-label"
              className="w-full"
              disabled={running}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {listingDurationOptions.map((option) => (
                <SelectItem key={option.days} value={String(option.days)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <p className="text-[13px] font-semibold">Order summary</p>

        <SummaryRow label="Items to list" value={String(itemCount)} />
        <SummaryRow
          label="Price"
          value={`${formatAmount(estimatedTotals.grossWei, decimals)} ${symbol}`}
        />
        <SummaryRow
          label="Est. fees"
          value={
            estimatedTotals.feeWei > 0n
              ? `-${formatAmount(estimatedTotals.feeWei, decimals)} ${symbol}`
              : `0 ${symbol}`
          }
        />

        <div className="bg-muted flex flex-col gap-0.5 rounded-[10px] p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              Net proceeds
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {formatAmount(estimatedTotals.netWei, decimals)} {symbol}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            after estimated marketplace & royalty fees
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}

        {summary && summary.total > 0 ? (
          <p className="text-muted-foreground text-xs">
            {summary.listed} of {summary.total} listed
            {summary.failed > 0 ? `, ${summary.failed} failed` : ''}
          </p>
        ) : null}
      </div>

      <div className="mt-auto shrink-0 border-t p-4">
        <Button
          className="h-10 w-full"
          onClick={onCreate}
          disabled={running || blockedReason !== null}
        >
          {running ? (
            <>
              <Spinner data-icon="inline-start" />
              Creating listings…
            </>
          ) : (
            'Create listings'
          )}
        </Button>
        {!running && blockedReason !== null ? (
          <p className="text-muted-foreground mt-2 text-xs">{blockedReason}</p>
        ) : null}
      </div>
    </Card>
  )
}
