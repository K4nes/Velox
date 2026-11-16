import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkCommitMessage,
  checkCommitMessages,
} from './check-commit-message.mjs'

test('a feat with a Test footer passes', () => {
  assert.deepEqual(
    checkCommitMessage(
      'feat(mint): name every scope in the summary\n\nTest: tests/mint/summary.e2e.ts'
    ),
    []
  )
})

test('a fix with a No test reason passes', () => {
  assert.deepEqual(
    checkCommitMessage('fix(mint): clear the cost\n\nNo test: copy change, no behaviour'),
    []
  )
})

test('a docs commit needs no footer', () => {
  assert.deepEqual(checkCommitMessage('docs: explain the mint summary'), [])
})

test('a breaking marker is allowed', () => {
  assert.deepEqual(
    checkCommitMessage(
      'feat(api)!: remove the legacy endpoint\n\nTest: tests/api/legacy.e2e.ts'
    ),
    []
  )
})

test('a merge commit is exempt', () => {
  assert.deepEqual(
    checkCommitMessage('Merge branch "main" into feature/summary'),
    []
  )
})

test('a feat without evidence fails', () => {
  assert.deepEqual(
    checkCommitMessage('feat(mint): name every scope'),
    ['feat, fix and perf need a "Test: <path>" or "No test: <reason>" footer']
  )
})

test('an unknown type fails', () => {
  assert.deepEqual(checkCommitMessage('feature(mint): add summary'), [
    '"feature" is not one of: feat, fix, refactor, perf, test, docs, style, build, ci, chore',
  ])
})

test('a long subject with a period fails', () => {
  const subject = `feat(mint): ${'a'.repeat(70)}.`
  assert.deepEqual(
    checkCommitMessage(`${subject}\n\nTest: tests/mint/summary.e2e.ts`),
    [`${subject.length} characters, the limit is 72`, 'ends with a period']
  )
})

test('the batch check prefixes the short sha', () => {
  assert.deepEqual(
    checkCommitMessages([
      { sha: 'abc1234', message: 'feat(mint): add summary' },
      {
        sha: 'def5678',
        message: 'fix(mint): clear cost\n\nTest: tests/mint/summary.e2e.ts',
      },
    ]),
    [
      'abc1234: feat, fix and perf need a "Test: <path>" or "No test: <reason>" footer',
    ]
  )
})
