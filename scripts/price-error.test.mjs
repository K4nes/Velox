import assert from 'node:assert/strict'
import { test } from 'node:test'

// Type stripping is unflagged from Node 22.18 and 23.6. Older releases in the
// repo's supported range cannot load the .ts module, so the case is skipped
// there instead of turning the suite red.
const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes =
  major >= 24 || (major === 22 && minor >= 18) || (major === 23 && minor >= 6)
const skip = stripsTypes ? false : 'needs Node >= 22.18 for type stripping'

async function load() {
  return import('../server/price.ts')
}

test('a provider message that quotes the key is redacted', { skip }, async () => {
  const { failureMessage } = await load()

  assert.equal(
    failureMessage(
      { status: { error_message: 'invalid key abc123, try another' } },
      'abc123'
    ),
    'invalid key [redacted], try another'
  )
})

test('a body with no provider message gets fixed copy', { skip }, async () => {
  const { failureMessage } = await load()

  assert.equal(failureMessage({}, 'abc123'), 'CoinMarketCap request failed')
})
