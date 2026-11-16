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
    lists?: { id: string; quantity: number; tokenId?: number }[]
  }
  body: {
    mintTransaction?: unknown
    erc20s?: unknown
  }
}

const recording: Recording = JSON.parse(
  readFileSync(join(import.meta.dirname, 'scatterMint.json'), 'utf8')
)

const nativeBuild = {
  mintTransaction: {
    to: '0x2222222222222222222222222222222222222222',
    data: '0x4a21a2df',
    value: '0',
  },
  erc20s: [],
}

// The refusal exists to stop a token-priced mint, so an allowance list whose shape cannot
// be read must refuse. Reading it as "no allowance" is the one failure that lets the mint
// through, so the message is captured rather than the throw simply asserted.
function refusalFrom(body: unknown): string {
  try {
    toScatterMintBuild(body)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

test('the recorded build parses, and an allowance list it cannot read refuses', () => {
  // The URL identifies which upstream response this is, and the request is what the
  // client sends: one list entry carrying the quantity.
  expect(recording.url).toContain('/mint')
  expect(recording.request?.collectionAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(recording.request?.chainId).toBeGreaterThanOrEqual(1)
  expect(recording.request?.lists).toHaveLength(1)
  expect(recording.request?.lists?.[0]?.quantity).toBeGreaterThanOrEqual(1)

  // A native-currency build answers an empty allowance list, and the parser must read that
  // as no refusal. A parser that stopped reading the field would pass every check below.
  expect(recording.body.erc20s).toEqual([])

  const build = toScatterMintBuild(recording.body)

  expect(build.to).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(build.data.startsWith('0x')).toBe(true)
  expect(build.data.length).toBeGreaterThan(10)
  // A native-currency build states its price in base units; the send site converts it.
  expect(/^\d+$/.test(build.value)).toBe(true)

  // Each unknown shape refuses, and a native answer above proves it fails for the shape
  // alone rather than because the parser rejects everything.
  expect(refusalFrom(nativeBuild)).toBe('')
  expect(refusalFrom({ ...nativeBuild, erc20s: {} })).toMatch(/cannot read/)
  expect(refusalFrom({ ...nativeBuild, erc20s: 'none' })).toMatch(/cannot read/)
  // An entry with no address is the same unknown, not an absence.
  expect(refusalFrom({ ...nativeBuild, erc20s: [{ amount: '1' }] })).toMatch(
    /cannot read/
  )
  // An address with an unreadable amount still names the token, so it refuses as itself.
  expect(
    refusalFrom({
      ...nativeBuild,
      erc20s: [{ address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }],
    })
  ).toMatch(/allowance for/)
})
