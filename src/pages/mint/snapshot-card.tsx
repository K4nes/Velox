import { useEffect, useRef } from 'react'
import { ChevronLeft, Eye, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  EligibilityResultSummary,
  EligibilityResultTable,
} from './eligibility-result-table'
import {
  formatSnapshotDate,
  summarizeSnapshot,
} from '@/lib/snapshots'
import type { EligibilitySnapshot } from '@/lib/snapshots'

type SnapshotCardProps = {
  snapshot: EligibilitySnapshot
  busy: boolean
  deleting: boolean
  onView: (id: string) => void
  onDelete: (id: string) => void
}

export function SnapshotCard({
  snapshot,
  busy,
  deleting,
  onView,
  onDelete,
}: SnapshotCardProps) {
  const name = snapshot.drop.name || snapshot.slug
  const summary = summarizeSnapshot(snapshot)

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          {snapshot.imageUrl ? (
            <img
              src={snapshot.imageUrl}
              alt=""
              className="size-6 shrink-0 rounded-sm object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          ) : null}
          <CardTitle className="truncate text-[13px] font-semibold">
            {name}
          </CardTitle>
          <Badge variant="secondary" className="ml-auto">
            {snapshot.marketplace}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>Chain</span>
          <span className="text-foreground">{snapshot.chainName}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Saved</span>
          <span className="text-foreground">
            {formatSnapshotDate(snapshot.createdAt)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Wallets</span>
          <span className="text-foreground">{summary.wallets}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Eligible</span>
          <span className="text-foreground">{summary.eligible}</span>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          data-snapshot-id={snapshot.id}
          onClick={() => onView(snapshot.id)}
        >
          <Eye />
          View Snapshot
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Delete ${name} snapshot`}
          aria-busy={deleting}
          className="hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          disabled={busy}
          onClick={(event) => {
            if (event.detail > 1) {
              return
            }
            onDelete(snapshot.id)
          }}
        >
          <Trash2 />
        </Button>
      </CardFooter>
    </Card>
  )
}

type SnapshotDetailProps = {
  snapshot: EligibilitySnapshot
  onBack: () => void
  onRefresh: () => void
  refreshing: boolean
  busy: boolean
  refreshError: string | null
}

export function SnapshotDetail({
  snapshot,
  onBack,
  onRefresh,
  refreshing,
  busy,
  refreshError,
}: SnapshotDetailProps) {
  const backRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    backRef.current?.focus()
  }, [])

  return (
    <Card className="flex flex-1 flex-col gap-0 overflow-hidden py-0">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <Button ref={backRef} variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft />
          All snapshots
        </Button>
        <div className="flex items-center gap-2">
          {refreshError ? (
            <span role="alert" className="text-destructive text-xs">
              {refreshError}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Refresh snapshot"
            aria-busy={refreshing}
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
          </Button>
        </div>
      </div>
      <div className="shrink-0 px-4 py-3">
        <EligibilityResultSummary
          name={snapshot.drop.name}
          imageUrl={snapshot.imageUrl}
          marketplace={snapshot.marketplace}
          chain={snapshot.chainName}
        />
      </div>
      <EligibilityResultTable
        state={{ status: 'ready', rows: snapshot.rows }}
        stageColumns={snapshot.stageColumns}
      />
    </Card>
  )
}
