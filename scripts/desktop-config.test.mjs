import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const TAURI = join(ROOT, 'src-tauri')

// The packaged webview applies this CSP to every page. Custom RPC endpoints are
// operator-supplied, so connect-src has to reach any HTTPS origin; script
// execution, framing and the base URI stay locked to the packaged app.
//
// `http://[::1]:*` is deliberately absent: CSP3's host-part excludes '[' and
// ':', so browsers ignore that source expression. Local nodes reached over IPv6
// loopback remain unreachable from the webview.
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

test('connect-src reaches user-supplied https rpc hosts and loopback nodes', () => {
  const { csp } = readJson(join(TAURI, 'tauri.conf.json')).app.security
  const connect = sources(csp, 'connect-src')

  for (const source of [
    'https:',
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://api.scatter.art',
    'https://api.opensea.io',
    'https://api.relay.link',
  ]) {
    assert.ok(connect.includes(source), `connect-src is missing ${source}`)
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
