import { ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
export function ExecutionLogPopover({
  label,
  address,
  error,
}: {
  label: string
  address: string
  error: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="link"
          size="xs"
          className="text-muted-foreground hover:text-foreground ml-2 h-auto p-0 align-baseline"
          aria-label={`Show execution log for ${address}`}
        >
          <ScrollText data-icon="inline-start" />
          Logs
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        aria-label={`Execution log for ${address}`}
        className="w-[min(26rem,calc(100vw-2rem))]"
      >
        <PopoverHeader>
          <PopoverTitle className="text-[13px] font-semibold">
            Execution log
          </PopoverTitle>
          <PopoverDescription className="text-xs">
            {label}
            <span className="block truncate font-mono text-xs">
              {address}
            </span>
          </PopoverDescription>
        </PopoverHeader>
        <div className="bg-muted/50 max-h-72 overflow-y-auto rounded-md p-2.5">
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            {error}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
