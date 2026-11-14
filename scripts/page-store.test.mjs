import assert from 'node:assert/strict'
import { test } from 'node:test'

// Type stripping is unflagged from Node 22.18 and 23.6. Older releases in the
// repo's supported range cannot load the .ts modules, so the shapes stay
// unchecked there instead of turning the suite red.
const [major, minor] = process.versions.node.split('.').map(Number)
const stripsTypes =
  major >= 24 || (major === 22 && minor >= 18) || (major === 23 && minor >= 6)
const skip = stripsTypes ? false : 'needs Node >= 22.18 for type stripping'

// Every field the Bulk Sell page keeps across a route change. A new field has
// to be added here on purpose, because this list is the review gate on what
// outlives the page: no private key and no provider key can enter it.
const RETAINED_FIELDS = [
  'durationDays',
  'error',
  'price',
  'progress',
  'query',
  'running',
  'selectedKeys',
  'state',
  'tab',
  'tokens',
  'url',
  'walletIds',
]

// The cancel tab keeps its own state across a route change, so it is reviewed by
// the same rule: what outlives the page cannot carry a key.
const RETAINED_CANCEL_FIELDS = [
  'error',
  'listings',
  'progress',
  'read',
  'running',
  'selectedKeys',
]

// One field list per store added after Bulk Sell. Each list is the review gate on
// what outlives a page: a field has to enter on purpose, and no private key or
// provider key can enter at all.
const RETAINED_STORES = [
  {
    name: 'PnL monthly',
    module: '../src/pages/pnl/state.ts',
    creator: 'createPnlMonthlyState',
    fields: ['month', 'query', 'selectedDay', 'sort'],
  },
  {
    name: 'PnL lifetime',
    module: '../src/pages/pnl/state.ts',
    creator: 'createPnlLifetimeState',
    fields: ['query', 'sort'],
  },
  {
    name: 'portfolio',
    module: '../src/pages/portfolio/state.ts',
    creator: 'createPortfolioState',
    fields: ['query', 'sort', 'starting', 'state', 'tier', 'url', 'walletIds'],
  },
  {
    name: 'transfer',
    module: '../src/pages/transfer/state.ts',
    creator: 'createTransferState',
    fields: [
      'destinationText',
      'error',
      'history',
      'probeState',
      'progress',
      'query',
      'resolved',
      'running',
      'selectedKeys',
      'spent',
      'state',
      'tokens',
      'url',
      'walletIds',
    ],
  },
  {
    name: 'instant sell',
    module: '../src/pages/instant-sell/state.ts',
    creator: 'createInstantSellState',
    fields: [
      'error',
      'offers',
      'offersCurrency',
      'progress',
      'query',
      'running',
      'selectedKeys',
      'state',
      'tokens',
      'url',
      'walletIds',
    ],
  },
  {
    name: 'swap',
    module: '../src/pages/swap/state.ts',
    creator: 'createSwapState',
    // The creator takes the default spec from the page module, which the type
    // stripper cannot load; the test only reviews the keys.
    args: [{}],
    fields: [
      'amounts',
      'batchError',
      'error',
      'pending',
      'preview',
      'previewPending',
      'progress',
      'resolved',
      'running',
      'spec',
      'walletIds',
    ],
  },
  {
    name: 'mint tasks',
    module: '../src/pages/mint/state.ts',
    creator: 'createMintTasksState',
    // The creator takes its first task from the store module; the test only
    // reviews the keys.
    args: [{}],
    fields: ['activeId', 'preparedMints', 'runs', 'runningIds', 'tasks'],
  },
  {
    name: 'mint eligibility',
    module: '../src/pages/mint/state.ts',
    creator: 'createMintEligibilityState',
    fields: ['checked', 'error', 'running', 'url', 'walletIds'],
  },
]

async function load() {
  const [{ createPageStore }, { createBulkSellState, createCancelState }] =
    await Promise.all([
      import('../src/lib/core/page-store.ts'),
      import('../src/pages/bulk-sell/state.ts'),
    ])
  return { createPageStore, createBulkSellState, createCancelState }
}

test('bulk sell retains exactly the reviewed fields', { skip }, async () => {
  const { createBulkSellState } = await load()

  assert.deepEqual(
    Object.keys(createBulkSellState()).sort(),
    [...RETAINED_FIELDS].sort(),
  )
})

test('the cancel tab retains exactly the reviewed fields', { skip }, async () => {
  const { createCancelState } = await load()

  assert.deepEqual(
    Object.keys(createCancelState()).sort(),
    [...RETAINED_CANCEL_FIELDS].sort(),
  )
})

for (const { name, module: path, creator, fields, args = [] } of RETAINED_STORES) {
  test(`${name} retains exactly the reviewed fields`, { skip }, async () => {
    const state = await import(path)
    assert.deepEqual(
      Object.keys(state[creator](...args)).sort(),
      [...fields].sort(),
    )
  })
}

test('the store refuses a field the state does not declare', { skip }, async () => {
  const { createPageStore, createBulkSellState } = await load()
  const store = createPageStore(createBulkSellState())

  assert.throws(() => store.set({ privateKey: '0x1234' }), /privateKey/)
  assert.throws(() => store.set({ openseaKey: 'key' }), /openseaKey/)

  store.set({ url: 'https://opensea.io/collection/mock' })
  assert.equal(store.get().url, 'https://opensea.io/collection/mock')
})

test('a newer read in one flow does not stale another flow', { skip }, async () => {
  const { createPageStore, createBulkSellState } = await load()
  const store = createPageStore(createBulkSellState())

  const run = store.open('run')
  const scan = store.open('scan')
  const newer = store.open('scan')

  assert.equal(run.live(), true)
  assert.equal(scan.live(), false)
  assert.equal(newer.live(), true)

  store.dropReads()
  assert.equal(run.live(), false)
  assert.equal(newer.live(), false)
})
