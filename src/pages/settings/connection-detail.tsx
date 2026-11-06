import { useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { Connection, Credential, Issue } from '@/lib/connections'
import { hasUsableCredentials } from '@/lib/connections'
import type { ProbeResult } from '@/lib/connection-probes'
import { EndpointsSection } from './endpoints-section'
import { KeysSection } from './keys-section'
import { ProviderMark } from './provider-mark'

type DetailActions = {
  patch: (update: (draft: Connection) => Connection) => void
  setCredentialValue: (credentialId: string, value: string) => void
  setAutoFallback: (value: boolean) => void
  save: () => void
  testAll: () => void
  testKey: (credential: Credential) => void
  remove: () => void
}

type ConnectionDetailProps = {
  draft: Connection
  dirty: boolean
  issues: Issue[]
  probes: Record<string, { value: string; result: ProbeResult }>
  busy: Set<string>
  actions: DetailActions
}

export function ConnectionDetail({
  draft,
  dirty,
  issues,
  probes,
  busy,
  actions,
}: ConnectionDetailProps) {
  const custom = draft.kind === 'rpc' && draft.provider === 'custom'
  const testing = busy.has(`all:${draft.id}`)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <ProviderMark id={draft.id} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {custom ? (
            <Input
              value={draft.name}
              onChange={(event) =>
                actions.patch((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              aria-label="Provider name"
              className="h-7 max-w-[220px] min-w-0 rounded-none border-0 bg-transparent px-0 text-[13px] font-semibold focus-visible:border-transparent focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
            />
          ) : (
            <h2 className="truncate text-[13px] font-semibold">
              {draft.name}
            </h2>
          )}
          <span className="truncate text-[11px] text-muted-foreground">
            {subLine(draft)}
          </span>
        </div>

        {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
        <Button
          variant="outline"
          onClick={actions.testAll}
          disabled={testing || !canTest(draft)}
        >
          <RefreshCw className={testing ? 'animate-spin' : undefined} />
          {draft.kind === 'rpc' ? 'Test endpoints' : 'Test all keys'}
        </Button>
        <Button onClick={actions.save}>Save</Button>
        {custom ? (
          <RemoveProvider name={draft.name} onRemove={actions.remove} />
        ) : null}
      </div>

      {issues.length > 0 ? (
        <div
          role="alert"
          className="mx-4 mt-3 shrink-0 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <ul className="flex flex-col gap-1 text-xs text-destructive">
            {issues.map((issue, index) => (
              <li key={`${issue.path}:${index}`}>
                {issue.message}
                <span className="ml-1.5 font-mono text-[11px] text-destructive/70">
                  {issue.path}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        <KeysSection
          testable={
            draft.kind === 'data-api' ||
            draft.endpoints.some((endpoint) => endpoint.url.includes('{key}'))
          }
          connectionName={draft.name}
          credentials={draft.credentials}
          autoFallback={draft.autoFallback}
          probes={probes}
          busy={busy}
          onPatch={(update) =>
            actions.patch((current) => ({
              ...current,
              credentials: update(current.credentials),
            }))
          }
          onValueChange={actions.setCredentialValue}
          onAutoFallback={actions.setAutoFallback}
          onTest={actions.testKey}
        />

        {draft.kind === 'rpc' ? (
          <EndpointsSection
            provider={draft.provider}
            endpoints={draft.endpoints}
            credentials={draft.credentials}
            busy={busy}
            onPatch={(update) =>
              actions.patch((current) =>
                current.kind === 'rpc'
                  ? { ...current, endpoints: update(current.endpoints) }
                  : current
              )
            }
          />
        ) : null}
      </div>
    </div>
  )
}

type RemoveProviderProps = {
  name: string
  onRemove: () => void
}

function RemoveProvider({ name, onRemove }: RemoveProviderProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${name}`}
          className="text-muted-foreground"
        >
          <Trash2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>Remove {name}?</PopoverTitle>
          <PopoverDescription className="text-xs">
            Its keys and endpoints are deleted. Chains fall back to their
            default RPC.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setOpen(false)
              onRemove()
            }}
          >
            Remove
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function subLine(connection: Connection): string {
  const count =
    connection.kind === 'rpc'
      ? new Set(connection.endpoints.map((endpoint) => endpoint.chain)).size
      : connection.credentials.length
  const noun = connection.kind === 'rpc' ? 'chain' : 'key'

  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// A keyless test would spend a request to learn nothing, so the header action
// stays off until at least one credential or endpoint can actually be checked.
function canTest(connection: Connection): boolean {
  const hasKey = hasUsableCredentials(connection.credentials)
  if (connection.kind === 'data-api') {
    return hasKey
  }

  return connection.endpoints.some(
    (endpoint) =>
      endpoint.url.trim() !== '' &&
      (!endpoint.url.includes('{key}') || hasKey)
  )
}
