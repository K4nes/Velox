import { TxHashLink } from '@/components/tx-hash-link'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MINT_COLUMNS, RUN_LABEL, RUN_TONE } from '@/lib/mint-task'
import type { RunStatus, WalletRun } from '@/lib/mint-task'
import { cn } from '@/lib/utils'

type RunTableProps = {
  runs: WalletRun[]
  stageUuid: string
  statusOf: (run: WalletRun) => RunStatus
}

export function RunTable({ runs, stageUuid, statusOf }: RunTableProps) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="min-h-0 flex-1 [&>[data-slot=table-container]]:h-full">
        <Table>
          <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
            <TableRow>
              {MINT_COLUMNS.map((column) => (
                <TableHead
                  key={column}
                  className="text-muted-foreground px-3 py-2 text-xs leading-tight font-medium whitespace-normal"
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={MINT_COLUMNS.length}
                  className="text-muted-foreground h-24 text-center"
                >
                  No data yet
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => {
                const rowStatus = statusOf(run)
                return (
                  <TableRow key={run.walletId} className="hover:bg-transparent">
                    <TableCell className="px-3 text-[13px] font-medium">
                      {run.label}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-3 text-xs">
                      {run.address}
                    </TableCell>
                    <TableCell className="px-3 text-[13px] tabular-nums">
                      {run.caps[stageUuid] ?? 0}
                    </TableCell>
                    <TableCell className="px-3 text-xs">
                      <span className={cn('font-medium', RUN_TONE[rowStatus])}>
                        {RUN_LABEL[rowStatus]}
                      </span>
                      {run.txHash && run.mintedStages.at(-1) === stageUuid ? (
                        <span className="ml-2">
                          <TxHashLink chain={run.chain} txHash={run.txHash} />
                        </span>
                      ) : null}
                      {run.error ? (
                        <span className="text-destructive ml-2">{run.error}</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
