import { Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

/**
 * One sentence for the live region, so every page that holds this card
 * announces the same thing. A page passes the message it already shows in the
 * table body, and the running and finished wordings come from here.
 */
export function scanAnnouncement(input: {
  running: boolean
  status: string
  message: string
}): string {
  if (input.running) return 'Scanning held tokens'
  if (input.status === 'ready') return 'Scan complete'
  return input.message
}

/**
 * The `Held NFT Inventory` bar: title and the count of the rows on screen on
 * the left, the filter alone on the right. Every page that renders this card
 * uses it, so the count cannot drift from the body it describes.
 */
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
          placeholder="Filter by token, ID or wallet"
          className="pl-8"
        />
      </div>
    </div>
  )
}
