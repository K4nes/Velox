import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { assetUrl, buildManifest, releaseNotes, verifyRelease } from './latest-json.mjs'

const ROOT = join(import.meta.dirname, '..')
const ENDPOINT = 'https://github.com/K4nes/Velox/releases/latest/download/latest.json'
const LINUX_ENDPOINT = 'https://github.com/K4nes/Velox/releases/latest/download/latest-linux.json'
const ARTIFACT = 'Velox_0.1.2_x64-setup.exe'
const LINUX_ARTIFACT = 'Velox_0.1.2_amd64.AppImage'
const PUB_DATE = '2026-11-12T00:00:00.000Z'

// Produced by `tauri signer sign Velox_0.1.2_x64-setup.exe --app-version 0.1.2`.
const SIGNATURE =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSTm1ZdjgwNms3bk5JWDlHeTFhV3VtMWs4NHRyeXYydVlOZFVHOGphekl0ZExua3Z3a2c3emN0dVpoMVp5VDRDd2ZPMHBpUGNoOGI3dHhkM1dBUXdqSjNzUE9oOTJzdWdvPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0NDc4NDYzCWZpbGU6VmVsb3hfMC4xLjJfeDY0LXNldHVwLmV4ZQl2ZXJzaW9uOjAuMS4yCkFQS2pUdFIxVzNIRTBlSzQ3YVUveDAzWVlZdGV5dDB4N1JxN2RuR3FiUGxhZDg0Tk9xU2xwM2JoRkhBRVFSQmFOZGR6Vk14d1lVVHp1emw4YTlZTEJRPT0K'

// What the signature verifier returns for the Windows artifact above.
const SIGNED = { version: '0.1.2', file: ARTIFACT, box: SIGNATURE }
// The same box stands in for the Linux artifact; verifyRelease compares fields,
// not the signature's trusted-comment file name.
const LINUX_SIGNED = { version: '0.1.2', file: LINUX_ARTIFACT, box: SIGNATURE }

function manifestFor(overrides = {}) {
  return buildManifest({
    version: '0.1.2',
    notes: 'Release notes.',
    fileName: ARTIFACT,
    signature: SIGNATURE,
    pubDate: PUB_DATE,
    endpoint: ENDPOINT,
    ...overrides,
  })
}

function verify(overrides = {}) {
  verifyRelease({
    manifest: manifestFor(),
    signed: SIGNED,
    artifactName: ARTIFACT,
    artifactVersion: '0.1.2',
    endpoint: ENDPOINT,
    ...overrides,
  })
}

function linuxManifestFor(overrides = {}) {
  return buildManifest({
    version: '0.1.2',
    notes: 'Release notes.',
    fileName: LINUX_ARTIFACT,
    signature: SIGNATURE,
    pubDate: PUB_DATE,
    endpoint: LINUX_ENDPOINT,
    platform: 'linux-x86_64',
    ...overrides,
  })
}

function verifyLinux(overrides = {}) {
  verifyRelease({
    manifest: linuxManifestFor(),
    signed: LINUX_SIGNED,
    artifactName: LINUX_ARTIFACT,
    artifactVersion: '0.1.2',
    endpoint: LINUX_ENDPOINT,
    platform: 'linux-x86_64',
    ...overrides,
  })
}

function withPlatform(overrides, platform = 'windows-x86_64') {
  const manifest = platform === 'linux-x86_64' ? linuxManifestFor() : manifestFor()
  return {
    ...manifest,
    platforms: { [platform]: { ...manifest.platforms[platform], ...overrides } },
  }
}

test('the Windows artifacts as they stand pass every check', () => {
  assert.doesNotThrow(() => verify())
})

test('the Linux artifacts as they stand pass every check', () => {
  assert.doesNotThrow(() => verifyLinux())
})

test('a manifest version that disagrees with the signed version is refused', () => {
  assert.throws(
    () => verify({ manifest: manifestFor({ version: '0.9.9' }), artifactVersion: '0.9.9' }),
    /manifest version 0\.9\.9 disagrees with the signed version 0\.1\.2/,
  )
})

test('a manifest version that disagrees with the artifact is refused', () => {
  assert.throws(
    () => verify({ artifactVersion: '0.9.9' }),
    /manifest version 0\.1\.2 disagrees with the artifact version 0\.9\.9/,
  )
})

test('a signature that names a different artifact is refused', () => {
  const artifactName = 'Velox_0.1.3_x64-setup.exe'
  assert.throws(
    () => verify({ manifest: manifestFor({ fileName: artifactName }), artifactName }),
    /the signature names Velox_0\.1\.2_x64-setup\.exe but the artifact is Velox_0\.1\.3_x64-setup\.exe/,
  )
})

test('a manifest signature that is not the artifact signature is refused', () => {
  assert.throws(
    () => verify({ manifest: withPlatform({ signature: SIGNATURE.replace(/^./, 'A') }) }),
    /the manifest signature is not the signature beside the artifact/,
  )
})

test('a manifest url that is not the release asset is refused', () => {
  assert.throws(
    () =>
      verify({
        manifest: withPlatform({
          url: 'https://evil.example/releases/download/v0.1.1/Velox_0.1.2_x64-setup.exe',
        }),
      }),
    /is not the release asset https:\/\/github\.com\/K4nes\/Velox\/releases\/download\/v0\.1\.2\/Velox_0\.1\.2_x64-setup\.exe/,
  )
})

test('a manifest for the wrong platform is refused', () => {
  assert.throws(
    () => verify({ manifest: linuxManifestFor() }),
    /manifest platforms must be exactly windows-x86_64, found linux-x86_64/,
  )
})

test('a missing CHANGELOG section is refused', () => {
  assert.equal(releaseNotes('## [0.1.2]\n\n- A fix.\n\n## [0.1.1]\n\n- Older.\n', '0.1.2'), '- A fix.')
  assert.throws(() => releaseNotes('## [0.1.2]\n\n- A fix.\n', '0.9.9'), /no CHANGELOG section for 0\.9\.9/)
})

test('assetUrl derives both platform URLs and refuses a foreign endpoint', () => {
  assert.equal(
    assetUrl({ endpoint: ENDPOINT, version: '0.1.2', fileName: ARTIFACT }),
    'https://github.com/K4nes/Velox/releases/download/v0.1.2/Velox_0.1.2_x64-setup.exe',
  )
  assert.equal(
    assetUrl({ endpoint: LINUX_ENDPOINT, version: '0.1.2', fileName: LINUX_ARTIFACT }),
    'https://github.com/K4nes/Velox/releases/download/v0.1.2/Velox_0.1.2_amd64.AppImage',
  )
  assert.throws(
    () => assetUrl({ endpoint: 'https://example.com/latest.json', version: '0.1.2', fileName: ARTIFACT }),
    /is not a GitHub latest\/download URL/,
  )
})

test('buildManifest emits exactly one windows-x86_64 platform', () => {
  const manifest = manifestFor()

  assert.deepEqual(Object.keys(manifest), ['version', 'notes', 'pub_date', 'platforms'])
  assert.equal(manifest.version, '0.1.2')
  assert.equal(manifest.notes, 'Release notes.')
  assert.equal(manifest.pub_date, PUB_DATE)
  assert.deepEqual(Object.keys(manifest.platforms), ['windows-x86_64'])
  assert.deepEqual(manifest.platforms['windows-x86_64'], {
    signature: SIGNATURE,
    url: 'https://github.com/K4nes/Velox/releases/download/v0.1.2/Velox_0.1.2_x64-setup.exe',
  })
})

test('buildManifest emits exactly one linux-x86_64 platform', () => {
  const manifest = linuxManifestFor()

  assert.deepEqual(Object.keys(manifest.platforms), ['linux-x86_64'])
  assert.deepEqual(manifest.platforms['linux-x86_64'], {
    signature: SIGNATURE,
    url: 'https://github.com/K4nes/Velox/releases/download/v0.1.2/Velox_0.1.2_amd64.AppImage',
  })
})

test('no tracked file contains the minisign secret key header', () => {
  // Assembled so this test file does not contain the sequence it searches for.
  const secretHeader = 'untrusted comment: ' + 'rsign encrypted secret key'
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '')

  const offenders = files.filter((file) =>
    readFileSync(join(ROOT, file), 'utf8').includes(secretHeader),
  )
  assert.deepEqual(offenders, [])
})
