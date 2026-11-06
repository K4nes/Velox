import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { chainBySlug, chains } from '@/config/chains'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Credential, Endpoint } from '@/lib/connections'
import { hasUsableCredentials } from '@/lib/connections'

type EndpointsSectionProps = {
  endpoints: Endpoint[]
  credentials: Credential[]
  busy: Set<string>
  onPatch: (update: (endpoints: Endpoint[]) => Endpoint[]) => void
}

export function EndpointsSection({
  endpoints,
  credentials,
  busy,
  onPatch,
}: EndpointsSectionProps) {
  const [open, setOpen] = useState(false)
  const covered = new Set(endpoints.map((endpoint) => endpoint.chain))
  const uncovered = chains.filter((chain) => !covered.has(chain.slug))
  const hasKey = hasUsableCredentials(credentials)

  function addEndpoint(chain: Endpoint['chain']) {
    onPatch((list) => [
      ...list,
      { id: crypto.randomUUID(), chain, url: '', probe: null },
    ])
    setOpen(false)
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">Endpoints</h3>
        <Badge variant="secondary">{endpoints.length}</Badge>
      </div>

      {endpoints.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No endpoints yet. Add one per chain you use.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {endpoints.map((endpoint) => {
            const label = chainBySlug(endpoint.chain)?.name ?? endpoint.chain
            const needsKey = endpoint.url.includes('{key}') && !hasKey

            return (
              <div
                key={endpoint.id}
                className="flex h-11 items-center gap-2 px-2"
              >
                <span className="w-24 shrink-0 truncate text-[11px] font-medium">
                  {label}
                </span>
                <Input
                  value={endpoint.url}
                  onChange={(event) =>
                    onPatch((list) =>
                      list.map((entry) =>
                        entry.id === endpoint.id
                          ? { ...entry, url: event.target.value, probe: null }
                          : entry
                      )
                    )
                  }
                  aria-label={`${label} endpoint URL`}
                  placeholder="https://"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="h-7 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 font-mono text-xs focus-visible:border-transparent focus-visible:ring-0 md:text-xs dark:bg-transparent"
                />
                <EndpointLatency
                  endpoint={endpoint}
                  needsKey={needsKey}
                  busy={busy.has(`endpoint:${endpoint.id}`)}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${label} endpoint`}
                      onClick={() =>
                        onPatch((list) =>
                          list.filter((entry) => entry.id !== endpoint.id)
                        )
                      }
                      className="text-muted-foreground"
                    >
                      <X />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove endpoint</TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full border-dashed">
            <Plus />
            Add endpoint
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1.5">
          {uncovered.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Every chain already has an endpoint.
            </p>
          ) : (
            <div className="flex flex-col">
              {uncovered.map((chain) => (
                <Button
                  key={chain.slug}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => addEndpoint(chain.slug)}
                >
                  {chain.name}
                </Button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </section>
  )
}

type EndpointLatencyProps = {
  endpoint: Endpoint
  needsKey: boolean
  busy: boolean
}

function EndpointLatency({ endpoint, needsKey, busy }: EndpointLatencyProps) {
  if (needsKey) {
    return (
      <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">
        Needs a key
      </span>
    )
  }

  if (busy) {
    return (
      <span className="flex w-20 shrink-0 justify-end">
        <Spinner className="size-3 text-muted-foreground" />
      </span>
    )
  }

  const probe = endpoint.probe
  if (probe === null) {
    return (
      <span className="w-20 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        —
      </span>
    )
  }

  if (probe.status === 'ok') {
    return (
      <span
        title={`Checked ${new Date(probe.at).toLocaleString()}`}
        className="w-20 shrink-0 text-right font-mono text-[11px] text-emerald-600 dark:text-emerald-400"
      >
        {probe.latencyMs} ms
      </span>
    )
  }

  return (
    <span
      title={`${probe.error} (checked ${new Date(probe.at).toLocaleString()})`}
      className="w-20 shrink-0 text-right font-mono text-[11px] text-destructive"
    >
      Failed
    </span>
  )
}
