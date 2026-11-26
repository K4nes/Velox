import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Connection, Credential, Issue } from '@/lib/chain/connections'
import {
  connectionIsReady,
  connectionSummary,
  endpointAcceptsKey,
  endpointIsCallable,
} from '@/lib/chain/connections'
import type { ProbeResult } from '@/lib/chain/connection-probes'
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
  const testing = busy.has(`all:${draft.id}`)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <ProviderMark id={draft.id} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="truncate text-[13px] font-semibold">
            {draft.name}
          </h2>
          <span className="truncate text-[11px] text-muted-foreground">
            {connectionSummary(draft)}
          </span>
        </div>

        {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
        <Button
          variant="outline"
          onClick={actions.testAll}
          disabled={testing || !connectionIsReady(draft)}
        >
          <RefreshCw className={testing ? 'animate-spin' : undefined} />
          {draft.kind === 'rpc' ? 'Test endpoints' : 'Test all keys'}
        </Button>
        <Button onClick={actions.save}>Save</Button>
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
            draft.endpoints.some(
              (endpoint) =>
                endpointAcceptsKey(endpoint, draft.provider) &&
                endpointIsCallable(endpoint, draft.provider)
            )
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
