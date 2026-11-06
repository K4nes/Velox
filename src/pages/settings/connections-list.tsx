import { useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import type { Connection } from '@/lib/connections'
import { connectionIsReady, connectionSummary } from '@/lib/connections'
import { ProviderMark } from './provider-mark'

type ConnectionsListProps = {
  connections: Connection[]
  drafts: Record<string, Connection>
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onAdd: (name: string) => void
}

export function ConnectionsList({
  connections,
  drafts,
  selectedId,
  loading,
  onSelect,
  onAdd,
}: ConnectionsListProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')

  function submit() {
    const trimmed = name.trim()
    if (trimmed === '') {
      return
    }
    onAdd(trimmed)
    setName('')
    setAddOpen(false)
  }

  const groups = [
    {
      label: 'Data APIs',
      rows: connections.filter((entry) => entry.kind === 'data-api'),
    },
    {
      label: 'RPC providers',
      rows: connections.filter((entry) => entry.kind === 'rpc'),
    },
  ]

  return (
    <Card className="flex h-[360px] min-h-0 w-full shrink-0 flex-col gap-0 overflow-hidden py-0 xl:h-auto xl:w-[336px]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="truncate text-[13px] font-semibold">Connections</h2>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Add provider">
              <Plus />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <PopoverHeader>
              <PopoverTitle className="text-[13px] font-semibold">
                Add provider
              </PopoverTitle>
              <PopoverDescription className="text-xs text-muted-foreground">
                Your own RPC provider. You paste its endpoint per chain.
              </PopoverDescription>
            </PopoverHeader>
            <Input
              aria-label="Provider name"
              placeholder="Provider name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submit()
                }
              }}
            />
            <Button
              className="w-full"
              disabled={name.trim() === ''}
              onClick={submit}
            >
              Add provider
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          groups.map((group) =>
            group.rows.length === 0 ? null : (
              <div key={group.label}>
                <p
                  className="px-3 py-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                  title={
                    group.label === 'RPC providers'
                      ? 'Tried in this order for each chain'
                      : undefined
                  }
                >
                  {group.label}
                </p>
                {group.rows.map((entry) => (
                  <ConnectionRow
                    key={entry.id}
                    connection={entry}
                    draft={drafts[entry.id]}
                    selected={entry.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )
          )
        )}
      </div>
    </Card>
  )
}

type ConnectionRowProps = {
  connection: Connection
  draft: Connection | undefined
  selected: boolean
  onSelect: (id: string) => void
}

function ConnectionRow({
  connection,
  draft,
  selected,
  onSelect,
}: ConnectionRowProps) {
  const configured =
    draft === undefined ? false : connectionIsReady(draft)

  return (
    <button
      type="button"
      onClick={() => onSelect(connection.id)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex h-[53px] w-full items-center gap-2 border-b border-l-2 px-3 text-left transition-colors',
        selected
          ? 'border-l-foreground bg-muted'
          : 'border-l-transparent hover:bg-muted/50'
      )}
    >
      <ProviderMark id={connection.id} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-semibold">
          {draft?.name ?? connection.name}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {connectionSummary(draft ?? connection)}
        </span>
      </span>
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          configured ? 'bg-emerald-500' : 'bg-muted-foreground/50'
        )}
        aria-hidden
      />
      <span className="sr-only">
        {configured ? 'Configured' : 'Not configured'}
      </span>
    </button>
  )
}
