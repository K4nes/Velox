import { PackageOpen, Search } from 'lucide-react'

import { BodyMessage } from '@/components/body-message'
import { RunStatusCell } from '@/components/run-status-cell'
import { TokenImage } from '@/components/token-image'
import { TxHashLink } from '@/components/tx-hash-link'
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
import type { TransferScanRow } from '@/hooks/use-transfer-scan'
import { shortAddress } from '@/lib/format'
import { TRANSFER_STEP_LABEL, TRANSFER_STEP_TONE } from '@/lib/transfer-run'
import type { TransferStepState } from '@/lib/transfer-run'

function StatusCell({
  step,
  chain,
  blockedReason,
}: {
  step: TransferStepState | undefined
  chain: string
  blockedReason: string | null
}) {
  if (!step) {
    return blockedReason ? (
      <span className="text-muted-foreground text-xs">{blockedReason}</span>
    ) : (
      <span className="text-muted-foreground text-xs">—</span>
    )
  }

  const live = step.status === 'signing' || step.status === 'confirming'
  const txHash = 'txHash' in step ? step.txHash : null

  return (
    <RunStatusCell
      className="max-w-[220px]"
      tone={TRANSFER_STEP_TONE[step.status]}
      label={TRANSFER_STEP_LABEL[step.status]}
      live={live}
      note={txHash ? <TxHashLink chain={chain} txHash={txHash} /> : undefined}
      error={
        step.status === 'failed' || step.status === 'unknown'
          ? step.error
          : undefined
      }
    />
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
  rows: readonly TransferScanRow[]
  totalRows: number
  query: string
  onQueryChange: (value: string) => void
  selectedKeys: readonly string[]
  tokenStates: Map<string, TransferStepState>
  running: boolean
  onToggleToken: (key: string) => void
  onToggleAll: () => void
}) {
  const selectable = rows.filter((row) => row.selectable)
  const selectedVisible = rows.filter((row) =>
    selectedKeys.includes(row.token.key)
  )
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
            <TableHead className="w-12 px-3">
              <Checkbox
                aria-label="Select every token in this view"
                checked={headerChecked}
                disabled={running}
                onCheckedChange={onToggleAll}
              />
            </TableHead>
            <TableHead className="text-muted-foreground px-3 text-xs font-medium">
              NFT
            </TableHead>
            <TableHead className="text-muted-foreground w-[150px] px-3 text-xs font-medium">
              Source wallet
            </TableHead>
            <TableHead className="text-muted-foreground w-[90px] px-3 text-xs font-medium">
              Chain
            </TableHead>
            <TableHead className="text-muted-foreground w-[170px] px-3 text-xs font-medium">
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const key = row.token.key
            const selected = selectedKeys.includes(key)
            const step = tokenStates.get(key)

            return (
              <TableRow key={key}>
                <TableCell className="px-3">
                  <Checkbox
                    aria-label={`Select token #${row.token.tokenId}`}
                    checked={selected}
                    disabled={running || !row.selectable}
                    title={
                      running
                        ? 'A transfer run is in progress'
                        : step?.status === 'unknown'
                          ? 'Unconfirmed. Check the explorer before retrying.'
                          : (row.blockedReason ?? undefined)
                    }
                    onCheckedChange={() => onToggleToken(key)}
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
                      <span
                        className="text-muted-foreground max-w-[220px] truncate text-xs tabular-nums"
                        title={`#${row.token.tokenId}`}
                      >
                        #{row.token.tokenId}
                      </span>
                    </div>
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
                  <span className="text-[13px]">{row.token.chain}</span>
                </TableCell>
                <TableCell className="px-3">
                  <StatusCell
                    step={tokenStates.get(key)}
                    chain={row.token.chain}
                    blockedReason={row.blockedReason}
                  />
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
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[13px] font-semibold">
            Held NFT Inventory
          </h2>
          <Badge variant="secondary">
            {totalRows} {totalRows === 1 ? 'item' : 'items'}
          </Badge>
        </div>
        <div className="relative w-60 shrink-0">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <label htmlFor="transfer-token-filter" className="sr-only">
            Filter tokens by name, collection or wallet
          </label>
          <Input
            id="transfer-token-filter"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Filter by token, name or wallet"
            className="pl-8"
          />
        </div>
      </div>

      {body()}
    </Card>
  )
}
