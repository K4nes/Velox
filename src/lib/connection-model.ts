// Types and pure resolvers for the settings connection registry. No runtime
// imports, and the only type import is `ChainSlug`, so plain Node can strip the
// types and exercise this module without the bundler's path aliases.
import type { ChainSlug } from '@/config/chains'

export type DataService = 'opensea' | 'coinmarketcap'
export type RpcProvider = 'alchemy' | 'quicknode' | 'ankr' | 'custom'

export type Credential = { id: string; value: string }

export type EndpointProbe =
  | { status: 'ok'; latencyMs: number; at: number }
  | { status: 'fail'; error: string; at: number }

export type Endpoint = {
  id: string
  chain: ChainSlug
  // May contain the literal {key}, which expandEndpoint fills per credential.
  url: string
  probe: EndpointProbe | null
}

type ConnectionBase = {
  name: string
  order: number
  autoFallback: boolean
  credentials: Credential[]
  updatedAt: number
}

export type DataApiConnection = ConnectionBase & {
  kind: 'data-api'
  id: DataService
}

export type RpcConnection = ConnectionBase & {
  kind: 'rpc'
  id: `rpc:${string}`
  provider: RpcProvider
  endpoints: Endpoint[]
}

export type Connection = DataApiConnection | RpcConnection

export type Issue = { path: string; message: string }

// Array order inside a connection is the only order for credentials and
// endpoints, so every resolver reads the arrays and never re-sorts them.
export function pickKeys(
  all: readonly Connection[],
  service: DataService
): string[] {
  const connection = all.find(
    (entry): entry is DataApiConnection =>
      entry.kind === 'data-api' && entry.id === service
  )
  if (connection === undefined) {
    return []
  }

  const keys = connection.credentials
    .map((credential) => credential.value.trim())
    .filter((value) => value !== '')

  return connection.autoFallback ? keys : keys.slice(0, 1)
}

export function hasUsableCredentials(
  credentials: readonly Credential[]
): boolean {
  return credentials.some((credential) => credential.value.trim() !== '')
}

export function expandEndpoint(
  endpoint: Endpoint,
  credentials: readonly Credential[],
  autoFallback: boolean
): string[] {
  if (!endpoint.url.includes('{key}')) {
    return [endpoint.url]
  }

  const keys = credentials
    .map((credential) => credential.value.trim())
    .filter((value) => value !== '')

  const usable = autoFallback ? keys : keys.slice(0, 1)
  // The replacer function keeps a key containing `$` from being read as a
  // replacement pattern.
  return usable.map((key) =>
    endpoint.url.replaceAll('{key}', () => encodeURIComponent(key))
  )
}

export function pickRpcUrls(all: readonly Connection[], slug: string): string[] {
  const ordered = all
    .filter((entry): entry is RpcConnection => entry.kind === 'rpc')
    .sort((a, b) => a.order - b.order)

  const urls: string[] = []
  for (const connection of ordered) {
    for (const endpoint of connection.endpoints) {
      if (endpoint.chain !== slug) {
        continue
      }
      urls.push(
        ...expandEndpoint(endpoint, connection.credentials, connection.autoFallback)
      )
    }
  }

  return [...new Set(urls)]
}

export function seedPlan(
  legacy: readonly { id: string; value: string }[],
  at: number,
  knownSlugs: readonly ChainSlug[]
): Connection[] {
  const openSeaKey = legacyValue(legacy, 'opensea-api-key')

  const legacyEndpoints: Endpoint[] = []
  for (const slug of knownSlugs) {
    const url = legacyValue(legacy, `rpc:${slug}`)
    if (url === '') {
      continue
    }
    legacyEndpoints.push({
      id: `legacy-${slug}`,
      chain: slug,
      url,
      probe: null,
    })
  }

  const hasCustom = legacyEndpoints.length > 0
  // A stored override used to be the only RPC for its chain, so it keeps
  // priority: the seeded providers shift up by one instead of outranking it.
  const shift = hasCustom ? 1 : 0

  const seeded: Connection[] = [
    {
      kind: 'data-api',
      id: 'opensea',
      name: 'OpenSea',
      order: shift,
      autoFallback: true,
      credentials:
        openSeaKey === '' ? [] : [{ id: 'legacy-opensea', value: openSeaKey }],
      updatedAt: at,
    },
    {
      kind: 'data-api',
      id: 'coinmarketcap',
      name: 'CoinMarketCap',
      order: shift + 1,
      autoFallback: true,
      credentials: [],
      updatedAt: at,
    },
    {
      kind: 'rpc',
      id: 'rpc:alchemy',
      name: 'Alchemy',
      provider: 'alchemy',
      order: shift + 2,
      autoFallback: true,
      credentials: [],
      endpoints: [],
      updatedAt: at,
    },
    {
      kind: 'rpc',
      id: 'rpc:quicknode',
      name: 'QuickNode',
      provider: 'quicknode',
      order: shift + 3,
      autoFallback: true,
      credentials: [],
      endpoints: [],
      updatedAt: at,
    },
    {
      kind: 'rpc',
      id: 'rpc:ankr',
      name: 'Ankr',
      provider: 'ankr',
      order: shift + 4,
      autoFallback: true,
      credentials: [],
      endpoints: [],
      updatedAt: at,
    },
  ]

  if (!hasCustom) {
    return seeded
  }

  return [
    ...seeded,
    {
      kind: 'rpc',
      id: 'rpc:custom:legacy',
      name: 'Custom RPC',
      provider: 'custom',
      order: 0,
      autoFallback: true,
      credentials: [],
      endpoints: legacyEndpoints,
      updatedAt: at,
    },
  ]
}

export function validateConnection(value: Connection): Issue[] {
  const issues: Issue[] = []

  if (value.name.trim() === '') {
    issues.push({ path: 'name', message: 'Name is required' })
  }

  value.credentials.forEach((credential, index) => {
    if (credential.value.trim() === '') {
      issues.push({
        path: `credentials.${index}.value`,
        message: 'Credential value is required',
      })
    }
  })

  if (value.kind === 'rpc') {
    const covered = new Set<string>()
    value.endpoints.forEach((endpoint, index) => {
      if (!isHttpUrl(endpoint.url)) {
        issues.push({
          path: `endpoints.${index}.url`,
          message: 'Endpoint must be a valid URL, with https when it carries a key',
        })
      }
      if (covered.has(endpoint.chain)) {
        issues.push({
          path: `endpoints.${index}.chain`,
          message: `${endpoint.chain} already has an endpoint`,
        })
      }
      covered.add(endpoint.chain)
    })
  }

  return issues
}

function legacyValue(
  legacy: readonly { id: string; value: string }[],
  id: string
): string {
  const record = legacy.find((entry) => entry.id === id)
  return record === undefined || typeof record.value !== 'string'
    ? ''
    : record.value.trim()
}

// A {key} endpoint is valid without a credential; the row renders as unusable
// until one is added, so the space it will occupy must still be a real URL.
function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.replaceAll('{key}', 'x'))
    if (parsed.protocol === 'https:') {
      return true
    }
    if (parsed.protocol !== 'http:') {
      return false
    }
    // A key in a clear-text URL leaks on every request; a loopback host is the
    // exception so a local node stays usable.
    return (
      !url.includes('{key}') ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    )
  } catch {
    return false
  }
}
