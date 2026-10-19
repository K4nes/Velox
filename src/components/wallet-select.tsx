
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export type WalletGroup = {
  id: string
  name: string
  wallets: { id: string; name: string }[]
}

type WalletSelectProps = {
  groups: WalletGroup[]
  selected: string[]
  onSelectedChange: (ids: string[]) => void
  className?: string
}

export function WalletSelect({
  groups,
  selected,
  onSelectedChange,
  className,
}: WalletSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((group) => ({
        ...group,
        wallets: group.wallets.filter((wallet) =>
          wallet.name.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.wallets.length > 0)
  }, [groups, query])

  const toggleWallet = (id: string) => {
    onSelectedChange(
      selectedSet.has(id)
        ? selected.filter((current) => current !== id)
        : [...selected, id]
    )
  }

  const toggleGroup = (group: WalletGroup) => {
    const ids = group.wallets.map((wallet) => wallet.id)
    const allSelected = ids.every((id) => selectedSet.has(id))
    onSelectedChange(
      allSelected
        ? selected.filter((id) => !ids.includes(id))
        : [...new Set([...selected, ...ids])]
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={className}>
          <span>Select wallets ({selected.length} selected)</span>
          <ChevronDown
            className={`ml-auto size-4 shrink-0 opacity-60 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 gap-2 p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search wallet name or address..."
            className="pl-8"
          />
        </div>

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {visibleGroups.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No wallets found.
            </p>
          ) : (
            visibleGroups.map((group) => {
              const ids = group.wallets.map((wallet) => wallet.id)
              const count = ids.filter((id) => selectedSet.has(id)).length
              const allSelected = count === ids.length

              return (
                <Collapsible key={group.id} className="group/collapsible">
                  <div className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon-sm">
                        <ChevronRight className="size-4 transition-transform group-data-open/collapsible:rotate-90" />
                      </Button>
                    </CollapsibleTrigger>
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() => toggleGroup(group)}
                      aria-label={`Select all in ${group.name}`}
                    />
                    <span className="flex-1 truncate text-sm font-medium">
                      {group.name}
                    </span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums">
                      {count}/{ids.length}
                    </span>
                  </div>

                  <CollapsibleContent>
                    <div className="mt-1 flex flex-col gap-0.5 pl-9">
                      {group.wallets.map((wallet) => (
                        <label
                          key={wallet.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            checked={selectedSet.has(wallet.id)}
                            onCheckedChange={() => toggleWallet(wallet.id)}
                          />
                          <span className="truncate">{wallet.name}</span>
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
