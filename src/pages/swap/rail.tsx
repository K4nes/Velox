import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import type { SwapPreview } from '@/hooks/use-swap-preview'
import type { SwapBatch } from '@/lib/swap/swap-batch'
import type { SwapRunSummary } from '@/lib/swap/swap-run'
import { formatSwapAmount, routeLabel } from '@/lib/swap/swap-spec'
import type { SwapSpec } from '@/lib/swap/swap-spec'

const OPERATION_LABEL: Record<SwapPreview['operation'], string> = {
  wrap: 'Wrap',
  unwrap: 'Unwrap',
  swap: 'Swap',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="text-right text-[13px] font-medium tabular-nums">
        {value}
      </dd>
    </div>
  )
}

export function SwapRail({
  spec,
  walletCount,
  batch,
  preview,
  summary,
  receivedTo,
  error,
  blockedReason,
  running,
  onExecute,
}: {
  spec: SwapSpec
  walletCount: number
  batch: SwapBatch | null
  preview: SwapPreview | null
  summary: SwapRunSummary | null
  receivedTo: SwapSpec['to'] | null
  error: string | null
  blockedReason: string | null
  running: boolean
  onExecute: () => void
}) {
  const counters: string[] = []
  if (summary) {
    if (summary.refunded > 0) counters.push(`${summary.refunded} refunded`)
    if (summary.failed > 0) counters.push(`${summary.failed} failed`)
    if (summary.unconfirmed > 0) {
      counters.push(`${summary.unconfirmed} unconfirmed`)
    }
    if (summary.skipped > 0) counters.push(`${summary.skipped} skipped`)
    if (summary.active > 0) counters.push(`${summary.active} pending`)
  }

  return (
    <div className="flex w-full shrink-0 flex-col lg:w-[300px]">
      <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <h2 className="truncate text-[13px] font-semibold">Swap</h2>
          <Badge variant="secondary">
            {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
          </Badge>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <dl className="flex flex-col gap-2">
            <Row label="Route" value={routeLabel(spec)} />
            <Row
              label="Operation"
              value={preview ? OPERATION_LABEL[preview.operation] : '—'}
            />
            <Row
              label="Total in"
              value={
                batch
                  ? `${formatSwapAmount(batch.total, spec.from.decimals)} ${spec.from.symbol}`
                  : '—'
              }
            />
            <Row
              label="Estimate · 1 wallet"
              value={
                preview
                  ? `≈ ${formatSwapAmount(preview.amountOut, spec.to.decimals)} ${spec.to.symbol}`
                  : '—'
              }
            />
          </dl>

          {summary && summary.total > 0 ? (
            <div className="flex flex-col gap-1 border-t pt-3">
              <p className="text-[13px] font-medium tabular-nums">
                {summary.done} of {summary.total} done
              </p>
              {counters.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  {counters.join(' · ')}
                </p>
              ) : null}
              {receivedTo && summary.received > 0n ? (
                <p className="text-muted-foreground text-xs tabular-nums">
                  {`≈ ${formatSwapAmount(summary.received, receivedTo.decimals)} ${receivedTo.symbol} quoted`}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-auto shrink-0 border-t p-4">
          {error ? (
            <p role="alert" className="text-destructive mb-2 text-xs">
              {error}
            </p>
          ) : null}

          <Button
            className="h-10 w-full"
            onClick={onExecute}
            disabled={running || blockedReason !== null}
          >
            {running ? (
              <>
                <Spinner data-icon="inline-start" />
                Swapping…
              </>
            ) : walletCount === 0 ? (
              'Select wallets to swap'
            ) : (
              `Swap ${walletCount} ${walletCount === 1 ? 'wallet' : 'wallets'}`
            )}
          </Button>

          {!running && blockedReason !== null ? (
            <p className="text-muted-foreground mt-2 text-xs">{blockedReason}</p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
