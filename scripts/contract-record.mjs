import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Writes the response the contract test reads, with the URL that produced it
// beside the body. A recording copied from another endpoint then cannot pass as
// the one it claims to be, which is the failure the mocked lane cannot see.

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'tests', 'contract')
// Cloudflare answers 403 `error 1010` to a client it does not read as a browser.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const NATIVE_CURRENCY = '0x0000000000000000000000000000000000000000'

// A mint build is a POST that names the collection, the chain and one list. The recorder
// reads the collection and its lists the way the app does, so a recording cannot name a
// list the API did not answer with. The build is unsigned calldata: nothing is signed.
async function scatterMintRequest(base, slug, pickList, missing) {
  const collection = await fetchJson(`${base}/collection/${encodeURIComponent(slug)}`)
  const lists = await fetchJson(
    `${base}/collection/${encodeURIComponent(slug)}/eligible-invite-lists`
  )
  const list = pickList(Array.isArray(lists) ? lists : [])
  if (collection?.address === undefined || list?.id === undefined) {
    fail(missing)
  }
  return {
    collectionAddress: collection.address,
    chainId: collection.chain_id,
    // A build signs nothing, so the minter is a placeholder rather than a key.
    minterAddress: '0x0000000000000000000000000000000000000001',
    lists: [{ id: list.id, quantity: 1 }],
  }
}

// `auth` names the env var holding the key; a public endpoint names none.
const FAMILIES = {
  collectionListings: {
    base: 'https://api.opensea.io/api/v2',
    auth: 'E2E_OPEN_SEA_KEY',
    path: (slug) => `/listings/collection/${encodeURIComponent(slug)}/all?limit=2`,
  },
  scatterLists: {
    base: 'https://api.scatter.art/v1',
    path: (slug) => `/collection/${encodeURIComponent(slug)}/eligible-invite-lists`,
  },
  // A mint build is a POST that names the collection, the chain and a list, so the
  // recorder reads the collection and its first list the way the app does, then mints
  // one quantity of it. The build is unsigned calldata: nothing is signed or sent.
  scatterMint: {
    base: 'https://api.scatter.art/v1',
    path: () => '/mint',
    method: 'POST',
    request: (base, slug) =>
      scatterMintRequest(
        base,
        slug,
        (lists) => lists[0],
        `${slug} has no collection address or no mint list`
      ),
  },
  // The same build, recorded from the collection's first token-priced list. The
  // answer carries the allowance a native list leaves empty, so the contract test
  // reads the real token address and base-unit amount rather than a hand-written one.
  scatterMintErc20: {
    base: 'https://api.scatter.art/v1',
    path: () => '/mint',
    method: 'POST',
    request: (base, slug) =>
      scatterMintRequest(
        base,
        slug,
        (lists) =>
          lists.find(
            (entry) =>
              typeof entry?.currency_address === 'string' &&
              entry.currency_address.toLowerCase() !== NATIVE_CURRENCY
          ),
        `${slug} has no collection address or no ERC-20 mint list`
      ),
  },
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

// One fetch path for the endpoints a family reads and the endpoint it records, so a
// status or parse failure reads the same whichever call produced it.
async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...init.headers },
    body: init.body,
  })

  const text = await response.text()
  if (!response.ok) {
    fail(`${String(response.status)} from ${url}: ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    fail(`${url} did not answer JSON: ${text.slice(0, 300)}`)
  }
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

const { base, auth, path, method, request } = target
const url = `${base}${path(slug)}`

const headers = {}
if (auth !== undefined) {
  const key = process.env[auth]
  if (key === undefined || key === '') {
    fail(`Missing ${auth}; put it in .env.e2e.local at the repo root`)
  }
  headers['x-api-key'] = key
}

const requestBody = request === undefined ? undefined : await request(base, slug)
if (requestBody !== undefined) {
  headers['content-type'] = 'application/json'
}

const body = await fetchJson(url, {
  method,
  headers,
  body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
})

mkdirSync(OUT_DIR, { recursive: true })
const file = join(OUT_DIR, `${family}.json`)
// A POST is described by its body as well as its URL, so the recording keeps the request
// it made.
const recording = {
  recordedAt: new Date().toISOString(),
  url,
  ...(requestBody === undefined ? {} : { request: requestBody }),
  body,
}
writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`)

console.log(`recorded ${file} from ${url}`)
