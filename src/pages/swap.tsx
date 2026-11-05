import { ArrowDown, ArrowLeftRight, RefreshCw } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
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
import { Spinner } from '@/components/ui/spinner'
import { WalletSelect } from '@/components/wallet-select'
import { chainBySlug, chains } from '@/config/chains'
import { useSwap } from '@/hooks/use-swap'
import type { SwapStatus } from '@/hooks/use-swap'
import { formatBalance } from '@/lib/wallet-model'

const PHASE: Record<SwapStatus['phase'], { label: string; tone: string }> = {
  idle: { label: 'Idle', tone: 'text-muted-foreground' },
  submitting: { label: 'Submitting', tone: 'text-foreground' },
  pending: { label: 'Pending', tone: 'text-foreground' },
  confirmed: { label: 'Confirmed', tone: 'text-success' },
  reverted: { label: 'Reverted', tone: 'text-destructive' },
  unconfirmed: { label: 'Unconfirmed', tone: 'text-warning' },
  failed: { label: 'Failed', tone: 'text-destructive' },
}

export function SwapPage() {
  const swap = useSwap()
  const phase = PHASE[swap.status.phase]
  const chainName = chainBySlug(swap.chainSlug)?.name ?? swap.chainSlug
  const reason = swap.plan.status === 'blocked' ? swap.plan.reason : null
  const alerting =
    reason === 'amount-invalid' ||
    reason === 'unavailable' ||
    reason === 'unsupported-chain'
  const tone =
    reason === 'insufficient-balance' || reason === 'insufficient-gas'
      ? 'text-warning'
      : alerting
        ? 'text-destructive'
        : 'text-muted-foreground'

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="gap-3 p-4 lg:flex-row lg:items-end">
        <div
          className="flex flex-col gap-1.5 lg:w-[280px]"
          role="group"
          aria-labelledby="swap-wallet-label"
        >
          <span id="swap-wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={swap.groups}
            selected={swap.walletIds}
            onSelectedChange={swap.setWalletIds}
            single
            disabled={swap.locked}
            aria-labelledby="swap-wallet-label"
            className="w-full"
          />
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="swap-chain" className="text-xs font-medium">
            Chain
          </label>
          <Select
            value={swap.chainSlug}
            onValueChange={swap.setChainSlug}
            disabled={swap.locked}
          >
            <SelectTrigger id="swap-chain" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {chains.map((chain) => (
                <SelectItem key={chain.slug} value={chain.slug}>
                  {chain.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          className="shrink-0"
          onClick={swap.refresh}
          disabled={!swap.canRefresh}
        >
          <RefreshCw className={swap.reading ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <h2 className="truncate text-[13px] font-semibold">Wrap / Unwrap</h2>
            <Badge variant="secondary">1:1</Badge>
          </div>

          <div className="flex flex-col gap-4 p-4">
            <div className="flex gap-2" role="group" aria-label="Direction">
              <Button
                variant={swap.direction === 'wrap' ? 'default' : 'outline'}
                className="flex-1"
                aria-pressed={swap.direction === 'wrap'}
                disabled={swap.locked}
                onClick={() => swap.setDirection('wrap')}
              >
                Wrap
              </Button>
              <Button
                variant={swap.direction === 'unwrap' ? 'default' : 'outline'}
                className="flex-1"
                aria-pressed={swap.direction === 'unwrap'}
                disabled={swap.locked}
                onClick={() => swap.setDirection('unwrap')}
              >
                Unwrap
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="swap-amount" className="text-xs font-medium">
                Amount ({swap.fromSymbol})
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="swap-amount"
                  inputMode="decimal"
                  placeholder="0.0"
                  className="tabular-nums"
                  value={swap.amount}
                  onChange={(event) => swap.setAmount(event.target.value)}
                  disabled={swap.locked}
                  aria-invalid={swap.invalidAmount}
                  aria-describedby="swap-amount-help swap-block"
                />
                <Button
                  variant="outline"
                  className="h-8 shrink-0"
                  onClick={swap.applyMax}
                  disabled={!swap.canMax || swap.locked}
                  aria-label="Use the maximum amount"
                >
                  MAX
                </Button>
              </div>
              <p
                id="swap-amount-help"
                className="text-muted-foreground text-[11px] tabular-nums"
              >
                Max{' '}
                {swap.max === null
                  ? '—'
                  : formatBalance(swap.max, swap.fromSymbol)}
              </p>
            </div>

            <dl className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[13px]">From</dt>
                <dd className="text-[13px] tabular-nums">
                  {swap.fromBalance === null
                    ? '—'
                    : formatBalance(swap.fromBalance, swap.fromSymbol)}
                </dd>
              </div>
              <div className="flex justify-center">
                <ArrowDown aria-hidden className="text-muted-foreground size-4" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[13px]">To</dt>
                <dd className="text-[13px] tabular-nums">
                  {swap.toBalance === null
                    ? '—'
                    : formatBalance(swap.toBalance, swap.toSymbol)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <dt className="text-[13px]">You receive</dt>
                <dd className="text-[13px] tabular-nums">
                  {swap.plan.status === 'ready'
                    ? formatBalance(swap.plan.amount, swap.toSymbol)
                    : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[13px]">Rate</dt>
                <dd className="text-muted-foreground text-[13px] tabular-nums">
                  1 {swap.fromSymbol} = 1 {swap.toSymbol} · no fee beyond gas
                </dd>
              </div>
            </dl>

            {swap.plan.status === 'blocked' ? (
              <div>
                <p
                  id="swap-block"
                  role={alerting ? 'alert' : undefined}
                  className={`text-xs ${tone}`}
                >
                  {swap.plan.message}
                </p>
                {swap.plan.reason === 'unavailable' && swap.readError ? (
                  <p className="text-muted-foreground mt-1 text-[11px] break-all">
                    {swap.readError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-auto shrink-0 border-t p-4">
            <Button
              className="h-10 w-full"
              disabled={swap.plan.status !== 'ready' || swap.locked}
              onClick={() => void swap.submit()}
            >
              {swap.status.phase === 'submitting' ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {swap.actionLabel}
            </Button>
          </div>
        </Card>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
          <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
              <h2 className="truncate text-[13px] font-semibold">Transaction</h2>
              <Badge variant="outline" className={phase.tone}>
                {phase.label}
              </Badge>
            </div>

            <dl className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[13px]">Wallet</dt>
                <dd className="min-w-0 text-right">
                  <span className="block truncate text-[13px] font-medium">
                    {swap.wallet?.label ?? '—'}
                  </span>
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {swap.wallet?.address ?? ''}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[13px]">Chain</dt>
                <dd className="text-muted-foreground text-[13px]">{chainName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[13px]">Max gas</dt>
                <dd className="text-muted-foreground text-[13px] tabular-nums">
                  {swap.gasCost === null
                    ? '—'
                    : formatBalance(swap.gasCost, swap.nativeSymbol)}
                </dd>
              </div>
            </dl>

            <div className="mt-auto shrink-0 border-t p-4" aria-live="polite">
              {swap.status.phase === 'idle' ? (
                <EmptyState
                  icon={ArrowLeftRight}
                  title="Nothing wrapped yet"
                  description="Pick a wallet and an amount, then wrap or unwrap."
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <span className={`text-[13px] font-medium ${phase.tone}`}>
                    {phase.label}
                  </span>
                  {swap.status.phase === 'confirmed' ? (
                    <span className="text-muted-foreground text-[11px]">
                      {swap.status.tx.direction === 'wrap'
                        ? 'Wrapped'
                        : 'Unwrapped'}{' '}
                      {formatBalance(
                        swap.status.tx.amount,
                        swap.status.tx.symbol
                      )}
                    </span>
                  ) : null}
                  {'tx' in swap.status ? (
                    <span className="font-mono text-[11px] break-all">
                      {swap.status.tx.txHash}
                    </span>
                  ) : null}
                  {swap.status.phase === 'failed' ||
                  swap.status.phase === 'unconfirmed' ? (
                    <span className="text-muted-foreground text-[11px] break-all">
                      {swap.status.message}
                    </span>
                  ) : null}
                  {swap.status.phase === 'unconfirmed' ? (
                    <Button
                      variant="outline"
                      className="h-8"
                      disabled={swap.checking}
                      onClick={() => void swap.recheck()}
                    >
                      {swap.checking ? (
                        <Spinner data-icon="inline-start" />
                      ) : null}
                      Check status
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
