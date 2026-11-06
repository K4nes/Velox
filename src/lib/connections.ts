import { chainBySlug } from '@/config/chains'
import { getAll, put, remove } from '@/lib/db'
import {
  pickKeys,
  pickRpcUrls,
  validateConnection,
} from '@/lib/connection-model'
import type {
  Connection,
  DataService,
  Issue,
  RpcConnection,
} from '@/lib/connection-model'

// One import site for the page: the model's types and pure helpers ride along
// with the storage calls.
export * from '@/lib/connection-model'

export class ConnectionError extends Error {
  readonly issues: Issue[]

  constructor(issues: Issue[]) {
    super(issues[0]?.message ?? 'Connection is invalid')
    this.name = 'ConnectionError'
    this.issues = issues
  }
}

// A chain whose stored endpoint cannot resolve never heals on its own, so
// consumers that retry on a timer can tell it apart from a network hiccup.
export class RpcConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcConfigError'
  }
}

export async function listConnections(): Promise<Connection[]> {
  const all = await getAll<Connection>('connections')
  return [...all].sort((a, b) => a.order - b.order)
}

export async function saveConnection(next: Connection): Promise<Connection> {
  const normalized = normalizeConnection(next)
  const issues = validateConnection(normalized)
  if (issues.length > 0) {
    throw new ConnectionError(issues)
  }

  await put<Connection>('connections', normalized)
  return normalized
}

export async function deleteConnection(
  id: RpcConnection['id']
): Promise<void> {
  await remove('connections', id)
}

export async function resolveKeys(service: DataService): Promise<string[]> {
  return pickKeys(await listConnections(), service)
}

export async function resolveRpcUrls(slug: string): Promise<string[]> {
  const all = await listConnections()
  const candidates = pickRpcUrls(all, slug)
  // A stored endpoint owns the chain even when it cannot be expanded yet, so a
  // keyless provider never reroutes traffic to a public node unasked.
  const stored = all.some(
    (entry) =>
      entry.kind === 'rpc' &&
      entry.endpoints.some((endpoint) => endpoint.chain === slug)
  )
  const configured = chainBySlug(slug)?.rpcUrl
  const urls =
    candidates.length > 0
      ? candidates
      : stored
        ? []
        : configured === undefined || configured === ''
          ? []
          : [configured]
  const deduped = [...new Set(urls)]

  if (deduped.length === 0) {
    throw new RpcConfigError(
      stored
        ? `No usable RPC for ${slug}: add a key or fix the endpoint`
        : `No RPC configured for ${slug}`
    )
  }
  return deduped
}

function normalizeConnection(value: Connection): Connection {
  const base = {
    name: value.name.trim(),
    order: value.order,
    autoFallback: value.autoFallback,
    credentials: value.credentials.map((credential) => ({
      id: credential.id,
      value: credential.value.trim(),
    })),
    updatedAt: Date.now(),
  }

  if (value.kind === 'data-api') {
    return { ...base, kind: 'data-api', id: value.id }
  }

  return {
    ...base,
    kind: 'rpc',
    id: value.id,
    provider: value.provider,
    endpoints: value.endpoints.map((endpoint) => ({
      ...endpoint,
      url: endpoint.url.trim(),
    })),
  }
}
