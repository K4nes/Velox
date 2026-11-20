import assert from 'node:assert/strict'
import test from 'node:test'
import { LANES, liveEnvProblems } from './live-env.mjs'

function configured(lane) {
  return Object.fromEntries(
    LANES[lane].map((name) => [name, name === 'E2E_ALLOW_MINT' ? '1' : 'set'])
  )
}

test('a lane names every value its cases need', () => {
  const problems = liveEnvProblems('live', {})
  assert.equal(problems.length, 1)
  assert.match(problems[0], /missing E2E_WALLET_KEY/)
})

test('an empty value counts as missing', () => {
  const env = { ...configured('mint'), E2E_SCATTER_ERC20_RPC_URL: '' }
  assert.match(
    liveEnvProblems('mint', env).join('\n'),
    /E2E_SCATTER_ERC20_RPC_URL/
  )
})

test('a mint lane whose gas gate is not on fails before the browser', () => {
  const env = { ...configured('mint'), E2E_ALLOW_MINT: '0' }
  assert.deepEqual(liveEnvProblems('mint', env), [
    'the mint lane would skip every gas case; set E2E_ALLOW_MINT=1',
  ])
})

test('a fully configured mint lane passes without the optional list name', () => {
  assert.deepEqual(liveEnvProblems('mint', configured('mint')), [])
})

test('an unknown lane is refused by name', () => {
  assert.match(
    liveEnvProblems('nope', {}).join('\n'),
    /unknown lane "nope"/
  )
})
