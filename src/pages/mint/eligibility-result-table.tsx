import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { EligibilityTableState, StageColumn } from '@/lib/eligibility'
import type { Marketplace } from '@/lib/snapshots'

export function EligibilityResultSummary({
  name,
  imageUrl,
  marketplace,
  chain,
}: {
  name: string
  imageUrl: string
  marketplace: Marketplace
  chain: string
}) {
  if (!name || !chain) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <span className="flex items-center gap-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="size-6 shrink-0 rounded-sm object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : null}
        <span className="text-sm font-medium">{name}</span>
      </span>
      <Badge variant="secondary">{marketplace}</Badge>
      <span className="text-muted-foreground">{chain}</span>
    </div>
  )
}

export function EligibilityResultTable({
  state,
  stageColumns,
}: {
  state: EligibilityTableState
  stageColumns: StageColumn[]
}) {
  const columnCount = 3 + Math.max(stageColumns.length, 1)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Table>
        <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
          <TableRow>
            <TableHead className="text-muted-foreground px-3 text-xs font-medium">
              #
            </TableHead>
            <TableHead className="text-muted-foreground px-3 text-xs font-medium">
              Wallet Profile
            </TableHead>
            <TableHead className="text-muted-foreground px-3 text-xs font-medium">
              Address
            </TableHead>
            {stageColumns.length > 0 ? (
              stageColumns.map((column) => (
                <TableHead
                  key={column.uuid}
                  className="text-muted-foreground px-3 text-center text-xs font-medium whitespace-normal"
                >
                  {column.label}
                </TableHead>
              ))
            ) : (
              <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                Mint Stage
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.status === 'error' ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columnCount}
                className="text-destructive h-24 text-center"
              >
                {state.message}
              </TableCell>
            </TableRow>
          ) : state.status === 'empty' ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columnCount}
                className="text-muted-foreground h-24 text-center"
              >
                {state.message}
              </TableCell>
            </TableRow>
          ) : (
            state.rows.map((row, index) => (
              <TableRow key={row.walletId} className="hover:bg-transparent">
                <TableCell className="px-3 text-xs tabular-nums">
                  {index + 1}
                </TableCell>
                <TableCell className="px-3 text-[13px] font-medium">
                  {row.label}
                </TableCell>
                <TableCell className="text-muted-foreground px-3 text-xs">
                  {row.address}
                </TableCell>
                {row.error ? (
                  <TableCell
                    colSpan={Math.max(stageColumns.length, 1)}
                    className="px-3 text-xs"
                  >
                    <span className="text-destructive">{row.error}</span>
                  </TableCell>
                ) : stageColumns.length > 0 ? (
                  stageColumns.map((column) => {
                    const stage = row.stages.find(
                      (entry) => entry.stageUuid === column.uuid
                    )
                    return (
                      <TableCell
                        key={column.uuid}
                        className="px-3 text-center text-xs"
                      >
                        {stage ? (
                          <span
                            className={
                              stage.eligible
                                ? 'text-success'
                                : 'text-muted-foreground'
                            }
                          >
                            {stage.eligible ? 'Eligible' : 'Not eligible'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )
                  })
                ) : (
                  <TableCell className="text-muted-foreground px-3 text-xs">
                    —
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
