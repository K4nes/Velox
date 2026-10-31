import { useLayoutEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { TaskListItem, TaskStatus } from '@/lib/mint-task'

type TaskListProps = {
  items: TaskListItem[]
  activeId: string | null
  busyIds?: string[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
}

const STATUS_DOT: Record<TaskStatus, string> = {
  idle: 'bg-muted-foreground',
  running: 'bg-success',
  failed: 'bg-destructive',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  idle: 'not running',
  running: 'running',
  failed: 'failed',
}

export function TaskList({ items, activeId, busyIds, onSelect, onClose, onAdd }: TaskListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<number | 'last' | null>(null)
  const focused = useRef<{ id: string; index: number } | null>(null)

  const rows = useMemo(
    () =>
      items.map((item, index) => ({
        item,
        position: `, task ${index + 1} of ${items.length}`,
      })),
    [items]
  )

  useLayoutEffect(() => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-task-select]')
    const present = buttons ? Array.from(buttons) : []

    const focusRow = (index: number) => {
      const row = present[Math.min(index, present.length - 1)]
      if (!row) {
        addRef.current?.focus()
        focused.current = null
        return
      }
      row.focus()
      row.scrollIntoView({ block: 'nearest' })
    }

    const target = pendingFocus.current
    if (target !== null) {
      pendingFocus.current = null
      focusRow(target === 'last' ? present.length - 1 : target)
      return
    }

    // A renamed row can unmount while focused: move focus to its neighbour
    // instead of letting it fall back to <body>.
    const previous = focused.current
    if (!previous) return
    if (present.some((row) => row.dataset.taskId === previous.id)) return
    focusRow(previous.index)
  }, [rows])

  function closeAt(index: number) {
    pendingFocus.current = index
    onClose(rows[index].item.id)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-task-select]')
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index === -1) return
    const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  return (
    <Card className="min-h-0 gap-0 py-0">
      <h2 className="sr-only">Tasks</h2>

      <div className="shrink-0 p-3">
        <button
          ref={addRef}
          type="button"
          onClick={() => {
            pendingFocus.current = 'last'
            onAdd()
          }}
          aria-label="New task"
          className={cn(
            'border-input hover:bg-muted/60 grid h-8 w-full place-items-center rounded-lg border transition-colors',
            'focus-visible:ring-ring/50 focus-visible:ring-[1px] focus-visible:outline-none'
          )}
        >
          <Plus className="size-4" />
        </button>
      </div>

      <p role="status" className="sr-only">
        {items.length === 1 ? '1 task' : `${items.length} tasks`}
      </p>

      <ul
        ref={listRef}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {rows.map(({ item, position }, index) => {
          const selected = item.id === activeId
          const busy = busyIds?.includes(item.id) ?? false
          const status = busy ? 'running' : item.status
          return (
            <li key={item.id} className="group/task relative">
              <button
                type="button"
                data-task-select
                data-task-id={item.id}
                aria-keyshortcuts="Delete"
                onClick={() => onSelect(item.id)}
                onFocus={() => {
                  focused.current = { id: item.id, index }
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Delete') return
                  if (busyIds?.includes(item.id)) return
                  event.preventDefault()
                  closeAt(index)
                }}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-left text-sm transition-colors',
                  'focus-visible:ring-ring/50 focus-visible:ring-[1px] focus-visible:outline-none',
                  selected
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <span
                  aria-hidden
                  className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])}
                />
                <span className="truncate" title={item.label}>
                  {item.label}
                </span>
                <span className="sr-only">{position}</span>
                <span className="sr-only">{STATUS_LABEL[status]}</span>
              </button>
              <button
                type="button"
                onClick={() => closeAt(index)}
                disabled={busy}
                aria-label={`Close ${item.label}${position}`}
                className={cn(
                  'text-muted-foreground hover:bg-destructive/10 hover:text-destructive absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded transition',
                  'opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100 focus-visible:ring-ring/50 focus-visible:ring-[1px] focus-visible:outline-none',
                  'disabled:pointer-events-none disabled:opacity-40'
                )}
              >
                <X className="size-3" />
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
