import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { diffLock } from './lockfile.mjs'

const ROOT = join(import.meta.dirname, '..')

function agreed() {
  return {
    manifest: { dependencies: { a: '^1.0.0' } },
    lock: {
      packages: {
        '': { dependencies: { a: '^1.0.0' } },
        'node_modules/a': { version: '1.0.0' },
      },
    },
  }
}

function writePair({ manifest, lock }) {
  const directory = mkdtempSync(join(tmpdir(), 'velox-lockfile-'))
  const manifestPath = join(directory, 'package.json')
  const lockPath = join(directory, 'package-lock.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  writeFileSync(lockPath, JSON.stringify(lock))
  return { manifestPath, lockPath }
}

test('a manifest and lock that agree report nothing', () => {
  assert.deepEqual(diffLock(agreed()), [])
})

test('a dependency the lock never resolved is refused', () => {
  const { manifest, lock } = agreed()
  manifest.dependencies.b = '^2.0.0'

  assert.deepEqual(diffLock({ manifest, lock }), [
    'dependencies: b is in package.json and not in the lock',
  ])
})

test('a range that disagrees with the lock is refused', () => {
  const { manifest, lock } = agreed()
  manifest.dependencies.a = '^2.0.0'

  assert.deepEqual(diffLock({ manifest, lock }), [
    'dependencies: a is ^2.0.0 in package.json and ^1.0.0 in the lock',
  ])
})

test('a dependency with no resolved entry in the lock is refused', () => {
  const { manifest, lock } = agreed()
  delete lock.packages['node_modules/a']

  assert.deepEqual(diffLock({ manifest, lock }), [
    'dependencies: a has no resolved entry in the lock',
  ])
})

test('a dependency the manifest dropped is refused', () => {
  const { manifest, lock } = agreed()
  delete manifest.dependencies.a

  assert.deepEqual(diffLock({ manifest, lock }), [
    'dependencies: a is in the lock and not in package.json',
  ])
})

test('the repo as it stands passes the command', () => {
  assert.match(
    execFileSync('node', ['scripts/check-lockfile.mjs'], { cwd: ROOT, encoding: 'utf8' }),
    /package-lock\.json matches package\.json/,
  )
})

test('the command refuses a manifest the lock does not cover', () => {
  const paths = writePair({
    manifest: { dependencies: { b: '^2.0.0' } },
    lock: { packages: { '': {} } },
  })

  assert.throws(
    () =>
      execFileSync('node', ['scripts/check-lockfile.mjs', paths.manifestPath, paths.lockPath], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    /is in package\.json and not in the lock/,
  )
})
