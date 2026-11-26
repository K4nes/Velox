import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const TAURI = join(ROOT, 'src-tauri')

// The packaged webview applies this CSP to every page. Settings no longer
// accepts an arbitrary RPC URL, so connect-src names only the providers and
// chain hosts the app itself calls; script execution, framing and the base URI
// stay locked to the packaged app.
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sources(csp, directive) {
  const value = csp[directive]
  return typeof value === 'string' ? value.split(/\s+/) : value
}

test('the capability grants the process restart the updater calls after installing', () => {
  const capability = readJson(join(TAURI, 'capabilities/default.json'))

  assert.ok(
    capability.permissions.some(
      (permission) => permission === 'process:allow-restart' || permission === 'process:default',
    ),
    `missing process restart permission: ${capability.permissions.join(', ')}`,
  )
})

test('connect-src stays on the configured providers, not every https host', () => {
  const { csp } = readJson(join(TAURI, 'tauri.conf.json')).app.security
  const connect = sources(csp, 'connect-src')

  for (const source of [
    'https://api.scatter.art',
    'https://api.opensea.io',
    'https://api.relay.link',
    'https://*.alchemy.com',
    'https://rpc.ankr.com',
  ]) {
    assert.ok(connect.includes(source), `connect-src is missing ${source}`)
  }

  for (const source of ['https:', 'http://localhost:*', 'http://127.0.0.1:*']) {
    assert.ok(!connect.includes(source), `connect-src still widens to ${source}`)
  }
})

test('img-src keeps the iconify source the icons load from', () => {
  const { csp } = readJson(join(TAURI, 'tauri.conf.json')).app.security

  assert.ok(sources(csp, 'img-src').includes('https://api.iconify.design'))
})

test('script execution, framing and the base uri stay locked to the packaged app', () => {
  const { csp } = readJson(join(TAURI, 'tauri.conf.json')).app.security

  assert.deepEqual(sources(csp, 'default-src'), ["'self'"])
  assert.deepEqual(sources(csp, 'script-src'), ["'self'"])
  assert.deepEqual(sources(csp, 'object-src'), ["'none'"])
  assert.deepEqual(sources(csp, 'frame-src'), ["'none'"])
  assert.deepEqual(sources(csp, 'base-uri'), ["'self'"])
})
