import assert from 'node:assert/strict'
import { test } from 'node:test'

// Type stripping is unflagged from Node 22.18 and 23.6. Older releases in the
// repo's supported range cannot load the .ts module, so the values stay
// unchecked there instead of turning the suite red.
const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes =
  major >= 24 || (major === 22 && minor >= 18) || (major === 23 && minor >= 6)
const skip = stripsTypes ? false : 'needs Node >= 22.18 for type stripping'

const { amountLabel } = stripsTypes
  ? await import('../src/lib/mint/amount.ts')
  : {}

const USDC = { symbol: 'USDC', decimals: 6 }

test('a zero amount prints as zero', { skip }, () => {
  assert.equal(amountLabel(0n, null), '0 ETH')
})

test('an amount below the printed precision never reads as free', { skip }, () => {
  // 0.00003 ETH: the value the live Hoodimals list states.
  assert.equal(amountLabel(30_000_000_000_000n, null), '<0.0001 ETH')
  assert.equal(amountLabel(1n, null), '<0.0001 ETH')
})

test('a printed amount keeps four places', { skip }, () => {
  assert.equal(amountLabel(100_000_000_000_000n, null), '0.0001 ETH')
  assert.equal(amountLabel(500_000_000_000_000_000n, null), '0.5000 ETH')
})

test("a stated currency keeps its own symbol and decimals", { skip }, () => {
  assert.equal(amountLabel(500_000n, { currency: USDC }), '0.5000 USDC')
  assert.equal(amountLabel(1_000n, { currency: USDC }), '0.0010 USDC')
  assert.equal(amountLabel(1n, { currency: USDC }), '<0.0001 USDC')
})
