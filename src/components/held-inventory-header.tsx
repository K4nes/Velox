import { Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

/**
 * One sentence for the live region. Every page that holds this card announces
 * the same thing, because the wording lives here and not at the call sites.
 * The flag is `scanning`, not a generic `running`: each page also runs a
 * listing, sell or transfer job, and announcing that job as a scan was the bug.
 */
export function scanAnnouncement(input: {
  scanning: boolean
  settled: { status: string; message?: string }
}): string {
  if (input.scanning) return 'Scanning held tokens'
  if (input.settled.status === 'ready') return 'Scan complete'
  return input.settled.message ?? ''
}

export function HeldInventoryHeader({
  count,
  query,
  onQueryChange,
  inputId,
  announcement,
}: {
  count: number
  query: string
  onQueryChange: (value: string) => void
  inputId: string
  announcement: string
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-[13px] font-semibold">
          Held NFT Inventory
        </h2>
        <Badge variant="secondary">
          {count} {count === 1 ? 'item' : 'items'}
        </Badge>
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
      </div>
      <div className="relative w-60 shrink-0">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <label htmlFor={inputId} className="sr-only">
          Filter tokens by name, token ID or wallet address
        </label>
        <Input
          id={inputId}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter by name, ID or wallet"
          className="pl-8"
        />
      </div>
    </div>
  )
}
