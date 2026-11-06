import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  probeCmcKey,
  probeOpenSeaKey,
  probeRpcEndpoint,
} from '@/lib/connection-probes'
import type { ProbeResult } from '@/lib/connection-probes'
import {
  ConnectionError,
  deleteConnection,
  expandEndpoint,
  listConnections,
  saveConnection,
} from '@/lib/connections'
import type {
  Connection,
  Credential,
  EndpointProbe,
  Issue,
  RpcConnection,
} from '@/lib/connections'
import { ConnectionDetail } from './connection-detail'
import { ConnectionsList } from './connections-list'

export function SettingsPage() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [drafts, setDrafts] = useState<Record<string, Connection>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [probes, setProbes] = useState<
    Record<string, { value: string; result: ProbeResult }>
  >({})
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [issues, setIssues] = useState<Issue[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  // A save and a remove can race on the same key. The delete lands first, the
  // queued put recreates the record, and a reload brings the provider back.
  const removed = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const list = await listConnections()

        if (cancelled) {
          return
        }

        setConnections(list)
        setDrafts(
          Object.fromEntries(list.map((entry) => [entry.id, entry]))
        )
        setSelectedId((current) =>
          current !== null && list.some((entry) => entry.id === current)
            ? current
            : (list[0]?.id ?? null)
        )
      } catch (failure) {
        if (!cancelled) {
          setLoadFailed(true)
          setLoadError(
            failure instanceof Error ? failure.message : String(failure)
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  // The blocked-database error clears only when the other tab closes, so the
  // page needs a way back without a full reload.
  function retry() {
    setLoading(true)
    setLoadFailed(false)
    setLoadError(null)
    setReloadToken((token) => token + 1)
  }

  const stored = connections.find((entry) => entry.id === selectedId) ?? null
  const draft = selectedId === null ? null : (drafts[selectedId] ?? null)
  const dirty =
    stored !== null &&
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(stored)

  function selectConnection(id: string) {
    setSelectedId(id)
    setIssues([])
  }

  function patchDraft(id: string, update: (draft: Connection) => Connection) {
    setDrafts((current) => {
      const entry = current[id]
      if (entry === undefined) {
        return current
      }
      return { ...current, [id]: update(entry) }
    })
  }

  async function tracked(key: string, work: () => Promise<void>) {
    setBusy((current) => new Set(current).add(key))
    try {
      await work()
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  function reportFailure(failure: unknown) {
    if (failure instanceof ConnectionError) {
      setIssues(failure.issues)
      toast.error(failure.issues[0]?.message ?? failure.message)
      return
    }

    const message =
      failure instanceof Error ? failure.message : String(failure)
    setLoadError(message)
    toast.error(message)
  }

  async function save(connection: Connection) {
    try {
      const saved = await saveConnection(connection)
      if (removed.current.has(saved.id) && saved.kind === 'rpc') {
        await deleteConnection(saved.id)
        return
      }
      setConnections((current) =>
        current.map((entry) => (entry.id === saved.id ? saved : entry))
      )
      setDrafts((current) =>
        // A keystroke that landed while the write was in flight stays a draft
        // edit, so the Unsaved badge returns instead of the edit vanishing.
        current[saved.id] === connection
          ? { ...current, [saved.id]: saved }
          : current
      )
      setIssues([])
      setLoadError(null)
      toast.success('Saved')
    } catch (failure) {
      reportFailure(failure)
    }
  }

  async function addProvider(name: string) {
    const order =
      connections.reduce((max, entry) => Math.max(max, entry.order), 0) + 1
    const next: RpcConnection = {
      kind: 'rpc',
      id: `rpc:${crypto.randomUUID()}`,
      provider: 'custom',
      name,
      order,
      autoFallback: true,
      credentials: [],
      endpoints: [],
      updatedAt: Date.now(),
    }

    try {
      const saved = await saveConnection(next)
      setConnections((current) => [...current, saved])
      setDrafts((current) => ({ ...current, [saved.id]: saved }))
      setSelectedId(saved.id)
      setIssues([])
      setLoadError(null)
    } catch (failure) {
      reportFailure(failure)
    }
  }

  async function removeConnection(id: RpcConnection['id']) {
    removed.current.add(id)
    try {
      await deleteConnection(id)
    } catch (failure) {
      removed.current.delete(id)
      reportFailure(failure)
      return
    }

    const remaining = connections.filter((entry) => entry.id !== id)
    setConnections(remaining)
    setDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setSelectedId(remaining[0]?.id ?? null)
    setIssues([])
  }

  function testKey(connection: Connection, credential: Credential) {
    const value = credential.value.trim()
    if (value === '') {
      return
    }

    const key = `key:${credential.id}`

    if (connection.kind === 'data-api') {
      const probe = connection.id === 'opensea' ? probeOpenSeaKey : probeCmcKey
      void tracked(key, async () => {
        const result = await probe(value)
        setProbes((current) => ({
          ...current,
          [credential.id]: { value, result },
        }))
      })
      return
    }

    // An RPC key is only exercised by a {key} endpoint, so the probe runs the
    // first one that consumes it rather than calling the provider directly.
    const endpoint = connection.endpoints.find((entry) =>
      entry.url.includes('{key}')
    )
    const target =
      endpoint === undefined
        ? undefined
        : expandEndpoint(endpoint, [credential], false)[0]
    if (target === undefined) {
      return
    }

    void tracked(key, async () => {
      const result = await probeRpcEndpoint(target)
      setProbes((current) => ({
        ...current,
        [credential.id]: { value, result },
      }))
    })
  }

  function testAll(connection: Connection) {
    void tracked(`all:${connection.id}`, async () => {
      if (connection.kind === 'data-api') {
        const probe =
          connection.id === 'opensea' ? probeOpenSeaKey : probeCmcKey
        for (const credential of connection.credentials) {
          const value = credential.value.trim()
          if (value === '') {
            continue
          }
          const result = await probe(value)
          setProbes((current) => ({
            ...current,
            [credential.id]: { value, result },
          }))
        }
        return
      }

      for (const endpoint of connection.endpoints) {
        // The probe runs what a caller would send first, which is the first
        // usable key, not the whole pool.
        const source = endpoint.url
        const target = expandEndpoint(
          endpoint,
          connection.credentials,
          false
        )[0]
        if (endpoint.url.trim() === '' || target === undefined) {
          continue
        }

        setBusy((current) =>
          new Set(current).add(`endpoint:${endpoint.id}`)
        )
        const result = await probeRpcEndpoint(target)
        setBusy((current) => {
          const next = new Set(current)
          next.delete(`endpoint:${endpoint.id}`)
          return next
        })

        const probe = toEndpointProbe(result)
        // A URL edited while the probe was in flight describes a different
        // endpoint, so its result must not land on the new text.
        patchDraft(connection.id, (current) =>
          current.kind === 'rpc'
            ? {
                ...current,
                endpoints: current.endpoints.map((entry) =>
                  entry.id === endpoint.id && entry.url === source
                    ? { ...entry, probe }
                    : entry
                ),
              }
            : current
        )
      }
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 xl:h-[calc(100svh-3rem)]">
      {loadError !== null ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-destructive">
            Settings storage error. {loadError}
          </p>
          {loadFailed ? (
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        <ConnectionsList
          connections={connections}
          drafts={drafts}
          selectedId={selectedId}
          loading={loading}
          onSelect={selectConnection}
          onAdd={(name) => void addProvider(name)}
        />

        <Card className="flex min-h-[520px] min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-[10px] py-0 xl:min-h-0">
          {loading ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-11 w-48" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : draft !== null && stored !== null ? (
            <ConnectionDetail
              draft={draft}
              dirty={dirty}
              issues={issues}
              probes={probes}
              busy={busy}
              actions={{
                patch: (update) => patchDraft(draft.id, update),
                setCredentialValue: (credentialId, value) => {
                  patchDraft(draft.id, (current) => ({
                    ...current,
                    credentials: current.credentials.map((credential) =>
                      credential.id === credentialId
                        ? { ...credential, value }
                        : credential
                    ),
                  }))
                  setProbes((current) => {
                    const next = { ...current }
                    delete next[credentialId]
                    return next
                  })
                },
                setAutoFallback: (value) =>
                  patchDraft(draft.id, (current) => ({
                    ...current,
                    autoFallback: value,
                  })),
                save: () => void save(draft),
                testAll: () => testAll(draft),
                testKey: (credential) => testKey(draft, credential),
                remove: () => {
                  if (draft.kind === 'rpc' && draft.provider === 'custom') {
                    void removeConnection(draft.id)
                  }
                },
              }}
            />
          ) : (
            <div className="flex-1" />
          )}
        </Card>
      </div>
    </div>
  )
}

// Probes never write storage; the latency lands on the draft and only a Save
// puts it in IndexedDB.
function toEndpointProbe(result: ProbeResult): EndpointProbe {
  if (result.ok) {
    return { status: 'ok', latencyMs: result.latencyMs, at: Date.now() }
  }
  return { status: 'fail', error: result.error, at: Date.now() }
}
