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
  const candidates = pickRpcUrls(await listConnections(), slug)
  // A stored endpoint replaces the config default, as it did before the
  // registry: falling back to a public node would route private traffic there
  // without the operator asking.
  const configured = chainBySlug(slug)?.rpcUrl
  const urls =
    candidates.length > 0
      ? candidates
      : configured === undefined || configured === ''
        ? []
        : [configured]
  const deduped = [...new Set(urls)]

  if (deduped.length === 0) {
    throw new Error(`No RPC configured for ${slug}`)
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
