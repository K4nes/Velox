// Drives a running packaged app over the WebView2 debugging port and asserts
// what a user would see. Two phases, because persistence needs a new process.
//
//   node scripts/desktop-check.mjs --phase drive     after the first launch
//   node scripts/desktop-check.mjs --phase restart   after a kill and relaunch
//
// The app must be started with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
const DEFAULT_PORT = 9222

const args = process.argv.slice(2)
const phaseFlag = args.indexOf('--phase')
const phase = phaseFlag === -1 ? 'drive' : args[phaseFlag + 1]
const portFlag = args.indexOf('--port')
const port = portFlag === -1 ? DEFAULT_PORT : Number(args[portFlag + 1])

const CHAIN_KEY = 'wallet-chain'
const CHAIN_SLUG = 'ape_chain'
const CHAIN_SYMBOL = 'APE'

const results = []

function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

async function connect() {
  let pages
  try {
    pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  } catch (failure) {
    throw new Error(
      `no debugging port on ${port}. Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${port} (${failure.message})`
    )
  }
  const page = pages.find((target) => target.type === 'page')
  if (!page) throw new Error(`no page target on ${port}`)

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  const violations = []

  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (message.method === 'Log.entryAdded') {
      const text = message.params?.entry?.text ?? ''
      if (text.includes('Content Security Policy')) violations.push(text)
      return
    }
    const settle = pending.get(message.id)
    if (settle) {
      pending.delete(message.id)
      settle(message)
    }
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  // CSP refusals reach the Log domain, and only for entries after it is enabled,
  // so the listener starts here rather than after the first navigation.
  socket.send(JSON.stringify({ id: (nextId += 1), method: 'Log.enable' }))

  const evaluate = async (expression) => {
    nextId += 1
    const id = nextId
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve)
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      )
    })
    if (reply.result?.exceptionDetails) {
      throw new Error(
        `expression threw: ${reply.result.exceptionDetails.exception?.description ?? 'unknown'}`
      )
    }
    return reply.result?.result?.value
  }

  return { evaluate, violations, close: () => socket.close() }
}

async function drive(evaluate) {
  const page = await evaluate(`({
    origin: location.origin,
    path: location.pathname,
    secure: isSecureContext,
    resourceOrigins: [...new Set(performance.getEntriesByType('resource').map((entry) => new URL(entry.name).origin))],
    header: document.querySelector('header')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    navHrefs: [...document.querySelectorAll('a[href^="/"]')].map((link) => link.getAttribute('href'))
  })`)

  check('the document is served from the app protocol', page.origin === 'http://tauri.localhost', page.origin)
  check('the origin is a secure context', page.secure === true, String(page.secure))
  // `ipc.localhost` is the app's own command channel, not a remote server.
  const appOrigins = ['http://tauri.localhost', 'http://ipc.localhost']
  check(
    'every resource comes from the app, none from a server',
    page.resourceOrigins.includes('http://tauri.localhost') &&
      page.resourceOrigins.every((origin) => appOrigins.includes(origin)),
    page.resourceOrigins.join(', ')
  )
  check('a route rendered', page.header.length > 0 && page.path !== '/', `${page.path} ${page.header}`)
  check('the sidebar offers navigation', page.navHrefs.length >= 5, `${page.navHrefs.length} links`)

  const moved = await evaluate(`(async () => {
    const link = document.querySelector('a[href="/swap"]')
    if (!link) return { error: 'no /swap link' }
    link.click()
    await new Promise((resolve) => setTimeout(resolve, 700))
    return { path: location.pathname, header: document.querySelector('header')?.innerText.replace(/\\s+/g, ' ').trim() ?? '' }
  })()`)
  check(
    'navigation changes the route',
    moved.path === '/swap' && moved.header.length > 0,
    `${moved.path} ${moved.header}`
  )

  await signIn(evaluate)

  const seeded = await evaluate(`(async () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 600))
    const toggle = () => document.querySelector('button[aria-label^="Switch to "]')
    // The button names the theme it switches to, so a machine that already opens
    // dark still exercises the write this check exists to prove. The storage
    // write lands after the click commits, so the read waits for it.
    if (document.documentElement.classList.contains('dark')) {
      toggle()?.click()
      await settle()
    }
    toggle()?.click()
    await settle()
    localStorage.setItem(${JSON.stringify(CHAIN_KEY)}, ${JSON.stringify(CHAIN_SLUG)})
    return { theme: localStorage.getItem('theme'), chain: localStorage.getItem(${JSON.stringify(CHAIN_KEY)}) }
  })()`)
  check('the theme toggle wrote storage', seeded.theme === 'dark', String(seeded.theme))
  check('the chain key is seeded for the restart phase', seeded.chain === CHAIN_SLUG, String(seeded.chain))

  await security(evaluate)
  await priceCheck(evaluate)
}

// The app declares its own ACL manifest, so a command no capability grants has
// to be refused before its handler runs. The probe names a command the app does
// not register, which is what a stray script reaching the IPC layer would try.
// The image probe uses the host a Settings provider mark comes from, so a policy
// that dropped img-src shows up as a failed load and a console entry.
async function security(evaluate) {
  const refused = await evaluate(`(async () => {
    try {
      const reply = await window.__TAURI_INTERNALS__.invoke('not_a_command')
      return { resolved: JSON.stringify(reply) }
    } catch (failure) {
      return { rejected: String(failure) }
    }
  })()`)
  check(
    'a command no capability grants is rejected',
    refused.rejected?.includes('not allowed') === true,
    refused.rejected ?? `resolved with ${refused.resolved}`
  )

  const mark = await evaluate(`new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve('loaded')
    image.onerror = () => resolve('failed')
    setTimeout(() => resolve('timed out'), 8000)
    image.src = 'https://api.iconify.design/token-branded/ankr.svg'
  })`)
  check('the policy allows the provider-mark host', mark === 'loaded', mark)
}

async function priceCheck(evaluate) {
  const reply = await evaluate(`(async () => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('eth_usdt_price', { key: null, probe: false })
    } catch (failure) {
      return { rejected: String(failure) }
    }
  })()`)
  check(
    'the packaged app registers the price command and reports the missing key',
    reply.status === 503,
    reply.rejected ?? `status ${reply.status}`
  )

  const card = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitFor = async (read, attempts) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const found = read()
        if (found !== null) return found
        await sleep(100)
      }
      return null
    }
    let link = document.querySelector('a[href="/pnl/card"]')
    if (link === null) {
      // The PnL group starts closed away from /pnl, so its link is not in the
      // document until the group opens.
      const trigger = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'PnL')
      trigger?.click()
      link = await waitFor(() => document.querySelector('a[href="/pnl/card"]'), 20)
    }
    if (link === null) return { error: 'no /pnl/card link', path: location.pathname }
    link.click()

    const notice = await waitFor(
      () => [...document.querySelectorAll('[role="status"]')].find((node) => node.innerText.includes('CoinMarketCap key')) ?? null,
      50
    )
    if (notice === null) {
      const seen = [...document.querySelectorAll('[role="status"]')].map((node) => node.innerText.replace(/\\s+/g, ' ').trim())
      return { error: seen.join(' | ') || 'no notice', path: location.pathname }
    }
    return {
      path: location.pathname,
      text: notice.innerText.replace(/\\s+/g, ' ').trim(),
      settings: notice.querySelector('a[href="/settings"]') !== null
    }
  })()`)
  check(
    'the card asks for a CoinMarketCap key and links to Settings',
    card.text?.includes('CoinMarketCap key') === true && card.settings === true,
    card.error ?? `${card.path} ${card.text ?? ''}`
  )
}

// The sign-in chain lives in Rust, so only an invoke from the window proves the
// packaged app can reach it. The nonce call reaches OpenSea, so an offline
// machine still passes on the shape and shows the status it got. The token call
// carries a malformed message and stops in Rust, which proves the payload keys
// `signInToken` sends deserialize.
async function signIn(evaluate) {
  const reply = await evaluate(`(async () => {
    try {
      const nonce = await window.__TAURI_INTERNALS__.invoke('auth_nonce', {
        address: '0x0000000000000000000000000000000000000000'
      })
      const token = await window.__TAURI_INTERNALS__.invoke('auth_token', {
        message: 'not-a-siwe-message',
        signature: '0xsigned'
      })
      return {
        nonce: { status: nonce?.status, message: nonce?.body?.message ?? nonce?.body?.error ?? '' },
        token: { status: token?.status, error: token?.body?.error ?? '' }
      }
    } catch (failure) {
      return { rejected: String(failure) }
    }
  })()`)
  check(
    'the packaged app registers both sign-in commands',
    typeof reply.nonce?.status === 'number' &&
      reply.nonce.message.length > 0 &&
      reply.token?.status === 400 &&
      reply.token.error === 'message does not match the OpenSea sign-in layout',
    reply.rejected ??
      `nonce ${reply.nonce?.status}, token ${reply.token?.status} ${reply.token?.error}`
  )
}

async function restart(evaluate) {
  const fresh = await evaluate(`({
    dark: document.documentElement.classList.contains('dark'),
    theme: localStorage.getItem('theme'),
    chain: localStorage.getItem(${JSON.stringify(CHAIN_KEY)})
  })`)
  check('the stored theme applied before any interaction', fresh.dark === true, String(fresh.dark))
  check('the theme survived the restart', fresh.theme === 'dark', String(fresh.theme))
  check('the chain survived the restart', fresh.chain === CHAIN_SLUG, String(fresh.chain))

  const shown = await evaluate(`(async () => {
    history.pushState({}, '', '/wallet-profiles')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await new Promise((resolve) => setTimeout(resolve, 900))
    return document.body.innerText.match(/TOTAL BALANCE[^A-Z]*([A-Z]+)/)?.[1] ?? ''
  })()`)
  check('the app read the stored chain', shown === CHAIN_SYMBOL, shown || 'no balance shown')
}

if (phase !== 'drive' && phase !== 'restart') {
  console.error(`unknown phase "${phase}": use --phase drive or --phase restart`)
  process.exit(2)
}

let session
try {
  session = await connect()
  await (phase === 'restart' ? restart(session.evaluate) : drive(session.evaluate))
  check(
    'the console shows no content-security violation',
    session.violations.length === 0,
    session.violations.join(' | ') || 'none'
  )
} catch (failure) {
  console.error(`FAIL ${failure.message}`)
  process.exit(1)
} finally {
  session?.close()
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed in phase "${phase}"`)
process.exit(failed.length === 0 ? 0 : 1)
