import { PackageOpen, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
import type { HeldToken } from '@/lib/holdings'
import { RUN_STEP_LABEL, RUN_STEP_TONE } from '@/lib/listing-run'
import type { RunStepState } from '@/lib/listing-run'
import { cn } from '@/lib/utils'

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address
}

function BodyMessage({
  icon: Icon,
  title,
  description,
  tone,
}: {
  icon: LucideIcon
  title: string
  description?: string
  tone?: string
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="flex flex-col items-center gap-1.5 p-8 text-center">
        <Icon aria-hidden className={cn('size-6', tone ?? 'text-muted-foreground')} />
        <p className="text-sm">{title}</p>
        {description ? (
          <p className="text-muted-foreground max-w-sm text-xs">{description}</p>
        ) : null}
      </div>
    </div>
  )
}

function StatusCell({ step }: { step: RunStepState | undefined }) {
  if (!step) {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  const live =
    step.status === 'approving' ||
    step.status === 'signing' ||
    step.status === 'submitting'

  return (
    <div className="flex max-w-[240px] flex-col gap-0.5">
      <span
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium',
          RUN_STEP_TONE[step.status]
        )}
      >
        {live ? <Spinner aria-hidden className="size-3" /> : null}
        {RUN_STEP_LABEL[step.status]}
        {step.status === 'listed' && step.orderHash ? (
          <span className="text-muted-foreground font-normal">
            {`${step.orderHash.slice(0, 8)}…`}
          </span>
        ) : null}
      </span>
      {step.status === 'failed' ? (
        <span
          className="text-muted-foreground truncate text-xs"
          title={step.error}
        >
          {step.error}
        </span>
      ) : null}
    </div>
  )
}

export function Inventory({
  state,
  rows,
  totalRows,
  query,
  onQueryChange,
  selectedKeys,
  tokenStates,
  running,
  onToggleToken,
  onToggleAll,
}: {
  state: HoldingsScanState
  rows: readonly HeldToken[]
  totalRows: number
  query: string
  onQueryChange: (value: string) => void
  selectedKeys: readonly string[]
  tokenStates: Map<string, RunStepState>
  running: boolean
  onToggleToken: (key: string) => void
  onToggleAll: () => void
}) {
  const selectable = rows.filter((row) => Math.floor(row.quantity) >= 1)
  const selectedVisible = rows.filter((row) => selectedKeys.includes(row.key))
  const headerChecked: boolean | 'indeterminate' =
    selectable.length > 0 && selectedVisible.length === selectable.length
      ? true
      : selectedVisible.length > 0
        ? 'indeterminate'
        : false

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
                checked={headerChecked}
                disabled={running}
                onCheckedChange={onToggleAll}
              />
            </TableHead>
            <TableHead className="text-muted-foreground px-3 text-xs font-medium">
              Token
            </TableHead>
            <TableHead className="text-muted-foreground w-[200px] px-3 text-xs font-medium">
              Wallet
            </TableHead>
            <TableHead className="text-muted-foreground w-[240px] px-3 text-xs font-medium">
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="pl-4">
                <Checkbox
                  aria-label={`Select token #${row.tokenId}`}
                  checked={selectedKeys.includes(row.key)}
                  disabled={running || Math.floor(row.quantity) < 1}
                  title={
                    Math.floor(row.quantity) < 1
                      ? 'Balance is below one whole unit, so this token cannot be listed'
                      : undefined
                  }
                  onCheckedChange={() => onToggleToken(row.key)}
                />
              </TableCell>
              <TableCell className="px-3">
                <div className="flex items-center gap-2.5">
                  <TokenImage
                    src={row.imageUrl}
                    alt={row.name || `Token #${row.tokenId}`}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="max-w-[220px] truncate text-[13px] font-medium">
                      {row.name || `#${row.tokenId}`}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      #{row.tokenId}
                    </span>
                  </div>
                  {row.quantity !== 1 ? (
                    <Badge variant="secondary">{`${row.quantity}×`}</Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="px-3">
                <div className="flex flex-col">
                  <span className="max-w-[180px] truncate text-[13px]">
                    {row.owner.label}
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {shortAddress(row.owner.address)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="px-3">
                <StatusCell step={tokenStates.get(row.key)} />
              </TableCell>
            </TableRow>
          ))}
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
            <label htmlFor="bulk-token-filter" className="sr-only">
              Filter tokens by token number
            </label>
            <Input
              id="bulk-token-filter"
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
