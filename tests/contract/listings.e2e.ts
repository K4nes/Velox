import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { toActiveListing } from '@/lib/opensea'

// PR #113 shipped the mocked lane green against an endpoint that does not
// exist, because the mock and the client were written from the same guess. This
// test reads a real response instead: `node scripts/contract-record.mjs
// --family collectionListings --slug <slug>` writes it, and the parser is run
// over it as-is.
type Recording = { recordedAt: string; url: string; body: unknown }

const recording: Recording = JSON.parse(
  readFileSync(join(import.meta.dirname, 'collectionListings.json'), 'utf8')
)

function listingsOf(body: unknown): unknown[] {
  const listings = (body as { listings?: unknown } | null)?.listings
  return Array.isArray(listings) ? listings : []
}

test('every recorded collection listing parses into a cancellable listing', () => {
  // The URL identifies which upstream response this is; a recording of another
  // path would otherwise parse into nothing and read as a contract failure.
  expect(recording.url).toContain('/listings/collection/')

  const listings = listingsOf(recording.body)
  expect(listings.length).toBeGreaterThan(0)

  // The parser's clock is the recording's own, so `expiresAtSec` proves the end
  // time was read rather than that the recording is still fresh.
  const nowSec = Math.floor(Date.parse(recording.recordedAt) / 1000)

  for (const raw of listings) {
    const listing = toActiveListing(
      raw as Parameters<typeof toActiveListing>[0],
      nowSec
    )
    expect(listing).not.toBeNull()
    const parsed = listing as NonNullable<typeof listing>

    expect(parsed.orderHash).toMatch(/^0x[0-9a-f]{64}$/i)
    expect(parsed.contract).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(parsed.tokenId).toMatch(/^\d+$/)
    expect(parsed.priceWei !== null && parsed.priceWei > 0n).toBe(true)
    expect(parsed.expiresAtSec).toBeGreaterThan(nowSec)
  }
})

test('a listing whose status is not ACTIVE is not cancellable', () => {
  const raw = listingsOf(recording.body)[0] as Record<string, unknown>
  const nowSec = Math.floor(Date.parse(recording.recordedAt) / 1000)

  // The collection endpoint publishes a status, and the cancel rail must not
  // offer an order the API already retired. An absent status keeps parsing,
  // because the older response shape carried only the boolean flags.
  for (const status of ['CANCELLED', 'FULFILLED', 'INACTIVE']) {
    const listing = toActiveListing(
      { ...raw, status } as Parameters<typeof toActiveListing>[0],
      nowSec
    )
    expect(listing).toBeNull()
  }
})
