import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { draftReleaseCommand } from './release-command.mjs'

const bundleDir = join('src-tauri', 'target', 'release', 'bundle', 'nsis')
const notes = '### Added\n\n- one thing'

test('the draft command names the tag and the three release files', () => {
  const installer = join(bundleDir, 'Velox_0.1.2_x64-setup.exe')
  assert.deepEqual(draftReleaseCommand({ version: '0.1.2', bundleDir, notes }), [
    'release',
    'create',
    'v0.1.2',
    '--draft',
    '--verify-tag',
    '--title',
    'Velox v0.1.2',
    '--notes',
    notes,
    installer,
    `${installer}.sig`,
    join(bundleDir, 'latest.json'),
  ])
})

test('every file the command uploads sits beside the manifest', () => {
  const files = draftReleaseCommand({ version: '0.1.2', bundleDir, notes }).filter((argument) =>
    argument.startsWith(bundleDir),
  )
  assert.equal(files.length, 3)
  assert.equal(files[1], `${files[0]}.sig`)
  assert.ok(files[2].endsWith('latest.json'))
})

test('the notes travel as one argument, newlines and all', () => {
  const argv = draftReleaseCommand({ version: '0.1.2', bundleDir, notes })
  const index = argv.indexOf('--notes')
  assert.notEqual(index, -1)
  assert.equal(argv[index + 1], notes)
})
