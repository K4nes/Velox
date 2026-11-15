import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { toScatterMintBuild } from '@/lib/scatter/index'

// `node scripts/contract-record.mjs --family scatterMint --slug <slug>` writes this file
// from the live endpoint. The mocked Scatter suite answers the fields the client was
// written against, so a renamed field stays green there; this test parses a real answer.
type Recording = {
  recordedAt: string
  url: string
  request?: {
    collectionAddress?: string
    chainId?: number
    minterAddress?: string
    lists?: { id: string; quantity: number }[]
  }
  body: unknown
}

const recording: Recording = JSON.parse(
  readFileSync(join(import.meta.dirname, 'scatterMint.json'), 'utf8')
)

test('the recorded Scatter mint build parses into one mint transaction', () => {
  // The URL identifies which upstream response this is, and the request is what the
  // client sends: one list entry carrying the quantity.
  expect(recording.url).toContain('/mint')
  expect(recording.request?.collectionAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(recording.request?.chainId).toBeGreaterThanOrEqual(1)
  expect(recording.request?.lists).toHaveLength(1)
  expect(recording.request?.lists?.[0]?.quantity).toBeGreaterThanOrEqual(1)

  const build = toScatterMintBuild(recording.body)

  expect(build.to).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(build.data.startsWith('0x')).toBe(true)
  expect(build.data.length).toBeGreaterThan(10)
  // A native-currency build states its price in base units; the send site converts it.
  expect(/^\d+$/.test(build.value)).toBe(true)
})
