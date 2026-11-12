import { join } from 'node:path'

// One definition of the draft-release command. The release runner calls it and
// a test reads the argv, so the command cannot drift from the artifacts and no
// one has to call GitHub to see what it would run.

export function installerName(version) {
  return `Velox_${version}_x64-setup.exe`
}

export function draftReleaseCommand({ version, bundleDir, notes }) {
  const tag = `v${version}`
  const installer = join(bundleDir, installerName(version))
  return [
    'release',
    'create',
    tag,
    '--draft',
    '--verify-tag',
    '--title',
    `Velox ${tag}`,
    '--notes',
    notes,
    installer,
    `${installer}.sig`,
    join(bundleDir, 'latest.json'),
  ]
}
