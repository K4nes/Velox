import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export function RunStatusCell({
  tone,
  label,
  live,
  note,
  error,
  className,
}: {
  tone: string
  label: string
  live: boolean
  note?: string
  error?: string
  className?: string
}) {
  return (
    <div className={cn('flex max-w-[240px] flex-col gap-0.5', className)}>
      <span
        className={cn('flex items-center gap-1.5 text-xs font-medium', tone)}
      >
        {live ? <Spinner aria-hidden className="size-3" /> : null}
        {label}
        {note ? (
          <span className="text-muted-foreground font-normal">{note}</span>
        ) : null}
      </span>
      {error ? (
        <span
          className="text-muted-foreground truncate text-xs"
          title={error}
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}
