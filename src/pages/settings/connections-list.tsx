import { useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import type { Connection } from '@/lib/connections'
import { hasUsableCredentials } from '@/lib/connections'
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
    <Card className="flex h-[360px] min-h-0 w-full shrink-0 flex-col gap-0 overflow-hidden rounded-[10px] py-0 xl:h-auto xl:w-[336px]">
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
                  className="px-3 py-3 text-[9px] font-medium tracking-wider text-muted-foreground uppercase"
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
  const configured = draft === undefined ? false : isConfigured(draft)

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
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {subLine(draft ?? connection)}
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

// A row is live once it holds something a call could use: a key for a data API,
// a usable endpoint for an RPC provider.
function isConfigured(connection: Connection): boolean {
  if (connection.kind === 'data-api') {
    return hasUsableCredentials(connection.credentials)
  }

  const hasKey = hasUsableCredentials(connection.credentials)
  return connection.endpoints.some(
    (endpoint) =>
      endpoint.url.trim() !== '' &&
      (!endpoint.url.includes('{key}') || hasKey)
  )
}

// The frame's sub-line counts what the row can act on, so a provider with only
// plain URLs reads as endpoints and a key pool reads as keys plus coverage.
function subLine(connection: Connection): string {
  const keys = connection.credentials.filter(
    (credential) => credential.value.trim() !== ''
  ).length

  if (connection.kind === 'data-api') {
    if (keys === 0) {
      return 'No keys'
    }
    const noun = `${keys} key${keys === 1 ? '' : 's'}`
    const first = connection.credentials.find(
      (credential) => credential.value.trim() !== ''
    )
    const last = first === undefined ? '' : last4(first.value)
    return last === '' ? noun : `${noun} · ${last}`
  }

  const chains = new Set(connection.endpoints.map((endpoint) => endpoint.chain))
    .size
  const endpoints = connection.endpoints.length
  if (endpoints === 0) {
    return keys === 0 ? 'No endpoints' : `${keys} key${keys === 1 ? '' : 's'}`
  }
  if (keys === 0) {
    return `${endpoints} endpoint${endpoints === 1 ? '' : 's'}`
  }
  return `${keys} key${keys === 1 ? '' : 's'} · ${chains} chain${chains === 1 ? '' : 's'}`
}

function last4(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4)
}
