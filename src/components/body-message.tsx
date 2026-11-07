import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export function BodyMessage({
  icon: Icon,
  title,
  description,
  tone,
}: {
  icon: LucideIcon
  title: string
  description?: string
  tone?: string
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="flex flex-col items-center gap-1.5 p-8 text-center">
        <Icon
          aria-hidden
          className={cn('size-6', tone ?? 'text-muted-foreground')}
        />
        <p className="text-sm">{title}</p>
        {description ? (
          <p className="text-muted-foreground max-w-sm text-xs">{description}</p>
        ) : null}
      </div>
    </div>
  )
}
