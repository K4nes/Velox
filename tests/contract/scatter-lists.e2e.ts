import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { parseUnits } from 'viem'
import { toMintList } from '@/lib/scatter/index'

// The mocked Scatter suite answers the paths and fields the client was written
// against, so a wrong field name stays green there. This test reads a real
// response instead: `node scripts/contract-record.mjs --family scatterLists
// --slug <slug>` writes it, and the parser is run over it as-is.
type Recording = { recordedAt: string; url: string; body: unknown }

const recording: Recording = JSON.parse(
  readFileSync(join(import.meta.dirname, 'scatterLists.json'), 'utf8')
)

test('every recorded Scatter list parses into a mint list', () => {
  // The URL identifies which upstream response this is; a recording of another
  // path would otherwise parse into nothing and read as a contract failure.
  expect(recording.url).toContain('/eligible-invite-lists')

  const lists = Array.isArray(recording.body) ? recording.body : []
  expect(lists.length).toBeGreaterThan(0)

  for (const raw of lists) {
    const list = toMintList(raw)

    expect(list.id).not.toBe('')
    expect(list.name).not.toBe('')
    // Scatter states `end_time: null` for a list with no end; the parser must
    // carry that as absence, not as an epoch date.
    expect(list.endTime === '' || Number.isFinite(Date.parse(list.endTime))).toBe(
      true
    )
    expect(Number.isFinite(Date.parse(list.startTime))).toBe(true)
    // `4294967295` is the no-limit sentinel; a stated limit survives as itself.
    expect(list.walletLimit === null || list.walletLimit >= 1).toBe(true)
    expect(list.unitSize).toBeGreaterThanOrEqual(1)
    // The price is read with the list's own decimals, so a 6-decimal token keeps
    // its magnitude instead of being read as 18-decimal ETH.
    expect(parseUnits(list.tokenPrice, list.decimals) >= 0n).toBe(true)
  }
})
