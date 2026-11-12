import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { verifyMinisign } from './minisign.mjs'

const ROOT = join(import.meta.dirname, '..')
// `tauri signer sign fixture.txt --app-version 0.1.2`, made with the update key.
const CONTENT = 'fixture content for the release suite'
const SIGNATURE =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSTm1ZdjgwNms3bklZMHNzSzNmTEZLMDE2bko5NDZ3VFVtZXEvRHZndkVSUzV3dXRSaktlVkN3YWNRTzI3ckR6RHN2RWlydlF2Rmk4ZTNMQ1NmTE5LbHRuVWxyY0RPNWc4PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0NDg1ODAzCWZpbGU6Zml4dHVyZS50eHQJdmVyc2lvbjowLjEuMgpDUnYvMk4waFZhL3o2ajNCRldkT3dlbXZnNldSb0Z6QXU0VTV4ZG5UTXowOEd1bGRjdnZZczdKVkFicitEYWt2b3N0VGQzSHJSVkx0bHRZN1hNY25DZz09Cg=='

function pubkey() {
  const config = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  return config.plugins.updater.pubkey
}

function box(text) {
  return Buffer.from(text).toString('base64')
}

test('the update key verifies a signed artifact and reports what it covers', () => {
  assert.deepEqual(
    verifyMinisign({ content: CONTENT, signatureBox: SIGNATURE, pubkey: pubkey() }),
    { version: '0.1.2', file: 'fixture.txt', box: SIGNATURE },
  )
})

test('one changed byte of the artifact is refused', () => {
  assert.throws(
    () =>
      verifyMinisign({ content: `${CONTENT} `, signatureBox: SIGNATURE, pubkey: pubkey() }),
    /the update signature does not match the installer/,
  )
})

test('a public key that is not the signing key is refused', () => {
  const text = Buffer.from(pubkey(), 'base64').toString('utf8').split('\n')
  const raw = Buffer.from(text[1], 'base64')
  raw[20] = raw[20] ^ 0xff
  const other = Buffer.from(`${text[0]}\n${raw.toString('base64')}\n`).toString('base64')

  assert.throws(
    () => verifyMinisign({ content: CONTENT, signatureBox: SIGNATURE, pubkey: other }),
    /the update signature does not match the installer/,
  )
})

test('a trusted comment that was edited after signing is refused', () => {
  const lines = Buffer.from(SIGNATURE, 'base64').toString('utf8').split('\n')
  lines[2] = lines[2].replace('version:0.1.2', 'version:0.9.9')

  assert.throws(
    () => verifyMinisign({ content: CONTENT, signatureBox: box(lines.join('\n')), pubkey: pubkey() }),
    /the update signature trusted comment does not match/,
  )
})

test('a malformed signature is refused before any file is read', () => {
  assert.throws(() => verifyMinisign({ content: CONTENT, signatureBox: '', pubkey: pubkey() }), /is empty/)
  assert.throws(
    () => verifyMinisign({ content: CONTENT, signatureBox: 'not base64!', pubkey: pubkey() }),
    /is not base64/,
  )
  assert.throws(
    () => verifyMinisign({ content: CONTENT, signatureBox: box('untrusted comment: x\n'), pubkey: pubkey() }),
    /has no trusted comment/,
  )
  assert.throws(
    () =>
      verifyMinisign({
        content: CONTENT,
        signatureBox: box('untrusted comment: x\nAAAA\ntrusted comment: file:y\nBBBB\n'),
        pubkey: pubkey(),
      }),
    /has no version field/,
  )
})
