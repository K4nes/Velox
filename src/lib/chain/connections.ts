import { chainBySlug } from '@/config/chains'
import { getAll, put } from '@/lib/db/db'
import {
  adoptStoredEndpoint,
  endpointTemplate,
  pickKeys,
  pickRpcUrls,
  validateConnection,
} from '@/lib/chain/connection-model'
import type {
  Connection,
  DataService,
  Endpoint,
  Issue,
} from '@/lib/chain/connection-model'

// One import site for the page: the model's types and pure helpers ride along
// with the storage calls.
export * from '@/lib/chain/connection-model'

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
  // A backup or an older profile can still hold a retired provider. It is
  // ignored rather than rendered, and the migration deletes it on upgrade.
  return [...all]
    .filter(
      (entry) =>
        entry.kind !== 'rpc' ||
        entry.provider === 'alchemy' ||
        entry.provider === 'ankr'
    )
    .sort((a, b) => a.order - b.order)
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
        ? `No usable RPC for ${slug}: add a provider key`
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

  // The URL is the provider's template, never a pasted endpoint. An older row
  // may still carry a full URL with its key embedded; adopt that key into
  // credentials instead of overwriting it. A foreign URL, an unsupported chain
  // or a keyed template with no key drops the endpoint so the chain can fall
  // back to `chains.ts`.
  let credentials = base.credentials
  const endpoints: Endpoint[] = []
  for (const endpoint of value.endpoints) {
    const template = endpointTemplate(value.provider, endpoint.chain)
    if (template === '') continue
    const adopted = adoptStoredEndpoint(endpoint.url, template)
    if (adopted === null) continue
    if (
      adopted.key !== null &&
      !credentials.some((credential) => credential.value === adopted.key)
    ) {
      credentials = [
        ...credentials,
        { id: `legacy-${endpoint.id}`, value: adopted.key },
      ]
    }
    if (
      template.includes('{key}') &&
      !credentials.some((credential) => credential.value.trim() !== '')
    ) {
      continue
    }
    endpoints.push({ ...endpoint, url: adopted.url })
  }

  return {
    ...base,
    credentials,
    kind: 'rpc',
    id: value.id,
    provider: value.provider,
    endpoints,
  }
}
