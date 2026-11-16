import { slugFromUrl } from '@/lib/opensea/index'

// The provider axis is a registry, not a two-member union. A third source adds one
// entry here and one entry in each module that maps over `CollectionSource`; no
// caller signature changes and no caller has to learn its name.
const collectionSources = {
  opensea: { marketplace: 'OpenSea' },
  scatter: { marketplace: 'Scatter' },
} as const

export type CollectionSource = keyof typeof collectionSources

export type Marketplace = (typeof collectionSources)[CollectionSource]['marketplace']

export type ResolvedCollection = {
  source: CollectionSource
  slug: string
}

export function marketplaceFor(source: CollectionSource): Marketplace {
  return collectionSources[source].marketplace
}

export function isCollectionSource(value: unknown): value is CollectionSource {
  return typeof value === 'string' && Object.hasOwn(collectionSources, value)
}

// A stored drop can predate the source field. OpenSea was the only reader then, so an
// absent or unknown value routes there; the old marketplace label is not evidence.
export function storedDropSource(stored: { source?: unknown }): CollectionSource {
  return isCollectionSource(stored.source) ? stored.source : 'opensea'
}

// The one detector every caller routes and labels a collection with. The host decides
// the source, so a bare slug and a 40-hex address keep the meaning they had before
// Scatter existed.
export function resolveCollectionSource(raw: string): ResolvedCollection | null {
  const value = raw.trim()
  if (!value) return null

  const url = parseUrl(value)
  if (url && isScatterHost(url.hostname)) {
    return scatterCollection(url)
  }

  const slug = slugFromUrl(value)
  return slug === null ? null : { source: 'opensea', slug }
}

function parseUrl(value: string): URL | null {
  // A bare slug has no slash and no scheme; `new URL` would read it as a host.
  if (!value.includes('/')) return null

  try {
    return new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    return null
  }
}

function isScatterHost(host: string): boolean {
  const name = host.toLowerCase()
  return name === 'scatter.art' || name.endsWith('.scatter.art')
}

// Scatter collection URLs are `/c/{slug}` and `/c/{slug}/{tokenId}`. The marker is
// read instead of the last segment, because a token page's last segment is the token.
function scatterCollection(url: URL): ResolvedCollection | null {
  const segments = url.pathname.split('/').filter(Boolean)
  const marker = segments.findIndex((segment) => segment.toLowerCase() === 'c')
  if (marker === -1) return null

  const slug = segments[marker + 1]
  if (!slug || /^\d+$/.test(slug)) return null

  const name = decodeSegment(slug)
  if (name === null) return null

  return { source: 'scatter', slug: name.toLowerCase() }
}

// `decodeURIComponent` throws on malformed input, and the mint check calls this
// resolver before its try block. A broken URL is "not recognised", not an exception.
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}
