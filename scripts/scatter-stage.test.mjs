import assert from 'node:assert/strict'
import { test } from 'node:test'

// Type stripping is unflagged from Node 22.18 and 23.6. Older releases in the
// repo's supported range cannot load the .ts module, so the shapes stay
// unchecked there instead of turning the suite red.
const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes =
  major >= 24 || (major === 22 && minor >= 18) || (major === 23 && minor >= 6)
const skip = stripsTypes ? false : 'needs Node >= 22.18 for type stripping'

const { SCATTER_NATIVE_CURRENCY, stageCurrency, stageUnitSize } = stripsTypes
  ? await import('../src/lib/scatter/stage-fields.ts')
  : {}

test('the native sentinel takes the chain symbol', { skip }, () => {
  assert.deepEqual(
    stageCurrency(
      {
        currencySymbol: '',
        currencyAddress: SCATTER_NATIVE_CURRENCY,
        decimals: 18,
      },
      'ETH'
    ),
    { symbol: 'ETH', decimals: 18, address: SCATTER_NATIVE_CURRENCY }
  )
})

test('a named token keeps its own symbol and decimals', { skip }, () => {
  assert.deepEqual(
    stageCurrency(
      {
        currencySymbol: 'USDC',
        currencyAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        decimals: 6,
      },
      'ETH'
    ),
    { symbol: 'USDC', decimals: 6, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }
  )
})

test('an unnamed token is named by address and keeps its decimals', { skip }, () => {
  assert.deepEqual(
    stageCurrency(
      {
        currencySymbol: '',
        currencyAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        decimals: 6,
      },
      'ETH'
    ),
    { symbol: '0x8335…2913', decimals: 6, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }
  )
})

test('a token with neither symbol nor address reads as a unit count', { skip }, () => {
  assert.deepEqual(
    stageCurrency(
      { currencySymbol: '', currencyAddress: '', decimals: 6 },
      'ETH'
    ),
    { symbol: 'tokens', decimals: 6, address: '' }
  )
})

test('a unit size above 1 is carried and one is omitted', { skip }, () => {
  assert.equal(stageUnitSize(5), 5)
  assert.equal(stageUnitSize(1), undefined)
})
