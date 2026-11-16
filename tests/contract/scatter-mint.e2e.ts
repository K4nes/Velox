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
  body: {
    mintTransaction?: unknown
    erc20s?: unknown
  }
}

const recording: Recording = JSON.parse(
  readFileSync(join(import.meta.dirname, 'scatterMint.json'), 'utf8')
)

type Erc20Recording = {
  recordedAt: string
  url: string
  request?: {
    collectionAddress?: string
    chainId?: number
    minterAddress?: string
    lists?: { id: string; quantity: number }[]
  }
  body: {
    mintTransaction?: { to?: string; data?: string; value?: string }
    erc20s?: { address: string; amount: string }[]
    listPayments?: {
      currencyAddress?: string
      currencySymbol?: string
      currencyDecimals?: number
      unitPaymentValue?: string
    }[]
  }
}

const erc20Recording: Erc20Recording = JSON.parse(
  readFileSync(join(import.meta.dirname, 'scatterMintErc20.json'), 'utf8')
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

test('the recorded ERC-20 build pins the collection as the allowance spender', () => {
  const request = erc20Recording.request
  const transaction = erc20Recording.body.mintTransaction
  const allowance = erc20Recording.body.erc20s?.[0]

  // The URL and request are the real ones, so the answer belongs to the list named here.
  expect(erc20Recording.url).toBe('https://api.scatter.art/v1/mint')
  expect(request?.collectionAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(request?.chainId).toBeGreaterThanOrEqual(1)
  expect(request?.lists).toHaveLength(1)
  expect(request?.lists?.[0]?.quantity).toBe(1)

  if (request?.collectionAddress === undefined || allowance === undefined) {
    throw new Error('the recording has no collection address or no allowance')
  }

  // The provider states the token and its base-unit amount, and no spender.
  expect(allowance.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(allowance.amount).toBe('20000000000000000000')
  expect(/^\d+$/.test(allowance.amount)).toBe(true)
  expect(BigInt(allowance.amount) > 0n).toBe(true)
  expect(allowance.address.toLowerCase()).not.toBe(
    request.collectionAddress.toLowerCase()
  )

  // The payment row repeats the allowance, which proves the amount is the token's base
  // unit rather than a display price.
  const payment = erc20Recording.body.listPayments?.[0]
  expect(payment?.currencyAddress?.toLowerCase()).toBe(allowance.address.toLowerCase())
  expect(payment?.currencyDecimals).toBe(18)
  expect(payment?.unitPaymentValue).toBe(allowance.amount)

  // The recorded build targets the collection itself. Scatter's approval example grants
  // the allowance to the collection address, and a batch mint's target may differ, so the
  // spender is resolved from the collection and never from `to`. If a later recording
  // targets another contract, this assertion sends the decision back for review.
  const spender = request.collectionAddress
  expect(transaction?.to?.toLowerCase()).toBe(spender.toLowerCase())

  // The committed parser consumes this real answer and refuses it before any signature.
  expect(refusalFrom(erc20Recording.body)).toContain(
    'ERC-20 allowance for 20000000000000000000 base units'
  )
})
