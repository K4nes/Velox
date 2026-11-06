// Types and pure resolvers for the settings connection registry. No runtime
// imports, and the only type import is `ChainSlug`, so plain Node can strip the
// types and exercise this module without the bundler's path aliases.
import type { ChainSlug } from '@/config/chains'

export type DataService = 'opensea' | 'coinmarketcap'
export type RpcProvider = 'alchemy' | 'ankr' | 'custom'

// Copied from each provider's own docs, which print the URL for a new project:
// the chain host and the key segment are the same for every account. `{key}`
// marks the segment a credential fills. A provider the docs do not pin down
// ships no template and the user adds it as a custom provider, pasting the URL
// it issued: a self-hosted node, or a paid host whose account subdomain is part
// of the URL.
const providerEndpoints: Record<
  RpcProvider,
  Partial<Record<ChainSlug, string>>
> = {
  alchemy: {
    ethereum: 'https://eth-mainnet.g.alchemy.com/v2/{key}',
    base: 'https://base-mainnet.g.alchemy.com/v2/{key}',
    robinhood: 'https://robinhood-mainnet.g.alchemy.com/v2/{key}',
    ape_chain: 'https://apechain-mainnet.g.alchemy.com/v2/{key}',
  },
  ankr: {
    ethereum: 'https://rpc.ankr.com/eth/{key}',
    base: 'https://rpc.ankr.com/base/{key}',
    robinhood: 'https://rpc.ankr.com/robinhood_mainnet/{key}',
  },
  custom: {},
}

export function endpointTemplate(
  provider: RpcProvider,
  chain: ChainSlug
): string {
  return (providerEndpoints[provider] ?? {})[chain] ?? ''
}

// The chains this provider serves on a URL the app can build. Empty means the
// provider's endpoints only exist as URLs the user pastes.
export function providerChains(provider: RpcProvider): Set<string> {
  return new Set(Object.keys(providerEndpoints[provider] ?? {}))
}

// A URL carrying its own path is used as typed, which keeps a pasted endpoint.
// A foreign host is left alone too: swapping in the provider's host would send
// that row's key to a server the user never configured. Only a bare host the
// provider itself hands out, or an empty row from an older build, takes the
// template, so the chain still points somewhere real. The scheme is ignored
// for the provider's own host: it serves https only, so the http form of that
// host is the same host mistyped and the template is the one URL that works.
export function endpointUrlTemplate(
  endpoint: Endpoint,
  provider: RpcProvider
): string {
  if (endpoint.url.includes('{key}')) {
    return endpoint.url
  }
  const template = endpointTemplate(provider, endpoint.chain)
  if (template === '') {
    return endpoint.url
  }
  if (endpoint.url.trim() === '') {
    return template
  }

  try {
    const parsed = new URL(endpoint.url)
    if (
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return endpoint.url
    }
    const templateUrl = new URL(template)
    const sameHost =
      parsed.hostname === templateUrl.hostname &&
      parsed.port === templateUrl.port
    return sameHost ? template : endpoint.url
  } catch {
    return endpoint.url
  }
}

// Save and the probes share this answer, so a cleartext URL carrying a key
// cannot slip past the rule by being tested instead of saved.
export function endpointIsCallable(
  endpoint: Endpoint,
  provider: RpcProvider
): boolean {
  return isHttpUrl(endpointUrlTemplate(endpoint, provider))
}

export function endpointAcceptsKey(
  endpoint: Endpoint,
  provider: RpcProvider
): boolean {
  return endpointUrlTemplate(endpoint, provider).includes('{key}')
}

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

// Both panes ask the same question, so they ask it here: a row counts once it
// resolves to a callable URL and, when that URL carries a key, a credential
// exists to fill it.
export function connectionIsReady(connection: Connection): boolean {
  if (connection.kind === 'data-api') {
    return hasUsableCredentials(connection.credentials)
  }

  const hasKey = hasUsableCredentials(connection.credentials)
  return connection.endpoints.some(
    (endpoint) =>
      endpointIsCallable(endpoint, connection.provider) &&
      (!endpointAcceptsKey(endpoint, connection.provider) || hasKey)
  )
}

// One summary for the list row and the detail header, so the two panes cannot
// describe the same connection differently.
export function connectionSummary(connection: Connection): string {
  const keys = connection.credentials.filter(
    (credential) => credential.value.trim() !== ''
  ).length

  if (connection.kind === 'data-api') {
    if (keys === 0) {
      return 'No keys'
    }
    const noun = `${keys} key${keys === 1 ? '' : 's'}`
    const first = connection.credentials.find(
      (credential) => credential.value.trim() !== ''
    )
    const last = first === undefined ? '' : last4(first.value)
    return last === '' ? noun : `${noun} · ${last}`
  }

  const endpoints = connection.endpoints.length
  if (endpoints === 0) {
    return keys === 0 ? 'No endpoints' : `${keys} key${keys === 1 ? '' : 's'}`
  }
  if (keys === 0) {
    return `${endpoints} endpoint${endpoints === 1 ? '' : 's'}`
  }
  const chains = new Set(
    connection.endpoints.map((endpoint) => endpoint.chain)
  ).size
  return `${keys} key${keys === 1 ? '' : 's'} · ${chains} chain${chains === 1 ? '' : 's'}`
}

function last4(value: string): string {
  const trimmed = value.trim()
  // Four characters or fewer are the whole secret, so there is nothing to show.
  return trimmed.length <= 4 ? '' : trimmed.slice(-4)
}

export function expandEndpoint(
  endpoint: Endpoint,
  credentials: readonly Credential[],
  autoFallback: boolean,
  provider: RpcProvider
): string[] {
  const template = endpointUrlTemplate(endpoint, provider)
  if (!template.includes('{key}')) {
    return [template]
  }

  const keys = credentials
    .map((credential) => credential.value.trim())
    .filter((value) => value !== '')

  const usable = autoFallback ? keys : keys.slice(0, 1)
  // The replacer function keeps a key containing `$` from being read as a
  // replacement pattern.
  return usable.map((key) =>
    template.replaceAll('{key}', () => encodeURIComponent(key))
  )
}

export function pickRpcUrls(all: readonly Connection[], slug: string): string[] {
  const ordered = all
    .filter((entry): entry is RpcConnection => entry.kind === 'rpc')
    .sort((a, b) => a.order - b.order)

  const urls: string[] = []
  for (const connection of ordered) {
    for (const endpoint of connection.endpoints) {
      if (
        endpoint.chain !== slug ||
        !endpointIsCallable(endpoint, connection.provider)
      ) {
        continue
      }
      urls.push(
        ...expandEndpoint(
          endpoint,
          connection.credentials,
          connection.autoFallback,
          connection.provider
        )
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
      id: 'rpc:ankr',
      name: 'Ankr',
      provider: 'ankr',
      order: shift + 3,
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
      if (!endpointIsCallable(endpoint, value.provider)) {
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
