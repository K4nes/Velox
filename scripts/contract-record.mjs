import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Writes the response the contract test reads, with the URL that produced it
// beside the body. A recording copied from another endpoint then cannot pass as
// the one it claims to be, which is the failure the mocked lane cannot see.

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'tests', 'contract')
const OPEN_SEA_BASE_URL = 'https://api.opensea.io/api/v2'
// Cloudflare answers 403 `error 1010` to a client it does not read as a browser.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const FAMILIES = {
  collectionListings: (slug) => ({
    path: `/listings/collection/${encodeURIComponent(slug)}/all`,
    query: 'limit=2',
  }),
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const family = flag('family')
const slug = flag('slug')
const target = family === undefined ? undefined : FAMILIES[family]

if (target === undefined) {
  fail(
    `Unknown --family ${String(family)}; use one of ${Object.keys(FAMILIES).join(', ')}`
  )
}
if (slug === undefined || slug === '') {
  fail('Missing --slug')
}

// Git-ignored, and the only place the key is allowed to sit.
const envFile = join(ROOT, '.env.e2e.local')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

const apiKey = process.env.E2E_OPEN_SEA_KEY
if (apiKey === undefined || apiKey === '') {
  fail('Missing E2E_OPEN_SEA_KEY; put it in .env.e2e.local at the repo root')
}

const { path, query } = target(slug)
const url = `${OPEN_SEA_BASE_URL}${path}?${query}`

const response = await fetch(url, {
  headers: {
    'x-api-key': apiKey,
    'user-agent': USER_AGENT,
    accept: 'application/json',
  },
})

const text = await response.text()
if (!response.ok) {
  fail(`${String(response.status)} from ${url}: ${text.slice(0, 300)}`)
}

let body
try {
  body = JSON.parse(text)
} catch {
  fail(`${url} did not answer JSON: ${text.slice(0, 300)}`)
}

mkdirSync(OUT_DIR, { recursive: true })
const file = join(OUT_DIR, `${family}.json`)
const recording = { recordedAt: new Date().toISOString(), url, body }
writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`)

console.log(`recorded ${file} from ${url}`)
