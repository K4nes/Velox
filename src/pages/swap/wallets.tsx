import { Layers } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { RunStatusCell } from '@/components/run-status-cell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { shortAddress } from '@/lib/format'
import { amountFor, formatSwapAmount, parseFixedAmount } from '@/lib/swap-spec'
import type { SwapAmounts } from '@/lib/swap-spec'
import { SWAP_WALLET_TONE, swapWalletLabel } from '@/lib/swap-run'
import type { SwapWalletState } from '@/lib/swap-run'
import type { SwapBatch } from '@/lib/swap-batch'

function StatusCell({ state }: { state: SwapWalletState | undefined }) {
  if (!state) {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  const live =
    state.status === 'queued' ||
    state.status === 'quoting' ||
    state.status === 'signing' ||
    state.status === 'confirming' ||
    state.status === 'waiting'
  const txHash = 'tx' in state && state.tx !== null ? state.tx.hash : null
  const detail =
    state.status === 'failed' || state.status === 'unconfirmed'
      ? state.error
      : state.status === 'skipped'
        ? state.reason
        : state.status === 'refunded'
          ? state.reason
          : state.status === 'waiting'
            ? state.detail
            : null

  return (
    <RunStatusCell
      tone={SWAP_WALLET_TONE[state.status]}
      label={swapWalletLabel(state)}
      live={live}
      note={txHash ? `${txHash.slice(0, 8)}…` : undefined}
      error={detail || undefined}
    />
  )
}

export function SwapWallets({
  batch,
  amounts,
  states,
  pending,
  disabled,
  onAmountChange,
  onMaxAmount,
}: {
  batch: SwapBatch | null
  amounts: SwapAmounts
  states: Map<string, SwapWalletState>
  pending: boolean
  disabled: boolean
  onAmountChange: (walletId: string, text: string) => void
  onMaxAmount: (walletId: string) => void
}) {
  const count = batch?.jobs.length ?? 0
  const sellSymbol = batch?.spec.from.symbol ?? ''
  const sellDecimals = batch?.spec.from.decimals ?? 18
  const nativeSell = batch?.spec.from.ref.kind === 'native'

  return (
    <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[13px] font-semibold">Wallets</h2>
          <Badge variant="secondary">
            {count} {count === 1 ? 'wallet' : 'wallets'}
          </Badge>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <Table aria-label="Swap wallets">
          <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
            <TableRow>
              <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                Wallet
              </TableHead>
              <TableHead className="text-muted-foreground w-[160px] px-3 text-xs font-medium">
                Balance
              </TableHead>
              <TableHead className="text-muted-foreground w-[200px] px-3 text-xs font-medium">
                Amount
              </TableHead>
              <TableHead className="text-muted-foreground w-[240px] px-3 text-xs font-medium">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batch?.jobs.map((job) => {
              const draft = amountFor(amounts, job.walletId)
              const hintId = `swap-amount-${job.walletId}`
              const parsed = parseFixedAmount(draft, sellDecimals)
              const invalidAmount =
                draft.kind === 'fixed' &&
                draft.text.trim() !== '' &&
                parsed === null
              const draftOverBalance =
                parsed !== null &&
                job.available !== null &&
                parsed > job.available
              const balanceUnreadable =
                job.balanceUnreadable &&
                (draft.kind === 'max' || draft.text.trim() !== '')
              const maxBlocked = draft.kind === 'max' && nativeSell
              const hint = maxBlocked
                ? `Max is not available for ${sellSymbol}`
                : invalidAmount
                  ? `Enter a valid ${sellSymbol} amount`
                  : balanceUnreadable
                    ? `Could not read ${sellSymbol} balance`
                    : draftOverBalance
                      ? 'Exceeds balance'
                      : null

              return (
                <TableRow key={job.walletId} className="h-14">
                  <TableCell className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium">
                        {job.label}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {shortAddress(job.address)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground px-3 py-2 text-[13px] tabular-nums">
                    {job.available === null
                      ? '—'
                      : `${formatSwapAmount(job.available, sellDecimals)} ${sellSymbol}`}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <Input
                          inputMode="decimal"
                          aria-label={`Amount for ${job.label}`}
                          aria-invalid={hint !== null || undefined}
                          aria-describedby={hint ? hintId : undefined}
                          placeholder={draft.kind === 'max' ? 'Max' : '0.0'}
                          value={draft.kind === 'fixed' ? draft.text : ''}
                          onChange={(event) => {
                            const next = event.target.value
                            if (/^\d*\.?\d*$/.test(next)) {
                              onAmountChange(job.walletId, next)
                            }
                          }}
                          disabled={disabled}
                          className="h-8 w-[110px] text-[13px] tabular-nums"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            draft.kind === 'max' ? 'secondary' : 'outline'
                          }
                          aria-pressed={draft.kind === 'max'}
                          aria-label={`Max for ${job.label}`}
                          onClick={() => onMaxAmount(job.walletId)}
                          disabled={disabled}
                        >
                          Max
                        </Button>
                      </div>
                      {hint ? (
                        <span id={hintId} className="text-destructive text-[11px]">
                          {hint}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <StatusCell state={states.get(job.walletId)} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {count === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState
              icon={Layers}
              title={pending ? 'Reading balances…' : 'No wallets in the batch'}
              description={
                pending
                  ? 'Balances resolve before the batch can be priced.'
                  : 'Pick the wallets and the trade above to price a swap.'
              }
            />
          </div>
        ) : null}
      </div>
    </Card>
  )
}
