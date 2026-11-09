import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { privateKeyToAccount } from 'viem/accounts'
import type { Browser, WebApp } from '@e2e-dev/web'
import type { Screen } from 'e2e'
import { openseaConnection, robinhoodRpc } from '../support/data'
import { seedVelox } from '../support/seed'
import type { FolderRow, WalletRow } from '../support/seed'

// Public Hardhat deployment key. It signs only this test's mocked requests.
const TEST_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ACCOUNT = privateKeyToAccount(TEST_KEY)
const CONTRACT = '0x00000000000000000000000000000000000000aa'
const SLUG = 'mock-drop'
const STAGE_UUID = 'stage-mock'

const FOLDER: FolderRow = {
  id: 'folder-mock',
  name: 'Mock',
  createdAt: 1_760_000_000_000,
}

const WALLET: WalletRow = {
  id: 'wallet-mock',
  folderId: FOLDER.id,
  label: 'mock',
  address: TEST_ACCOUNT.address,
  privateKey: TEST_KEY,
  createdAt: FOLDER.createdAt,
}

type TraceEvent = {
  at: number
  wall: number
  kind: string
  ok?: boolean
  chainMs?: number
}

declare global {
  interface Window {
    __veloxMintTrace?: { snapshot: () => TraceEvent[] }
  }
}

type Counters = {
  nonce: number
  token: number
  drop: number
  eligibility: number
  mint: number
  mintOk: number
}

type Clock = { startMs: number; leadMs: number; mintDelayMs: number }

async function serveAuth(browser: Browser, counters: Counters): Promise<void> {
  await browser.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request.url).pathname
    if (path === '/api/auth/nonce') {
      counters.nonce += 1
      await route.fulfill({
        status: 200,
        json: { message: 'velox deterministic sign-in' },
      })
      return
    }
    if (path === '/api/auth/token') {
      counters.token += 1
      await route.fulfill({
        status: 200,
        json: {
          token: 'deterministic-token',
          expiresAt: Date.now() + 3_600_000,
        },
      })
      return
    }
    await route.abort()
  })
}

async function serveOpenSea(
  browser: Browser,
  counters: Counters,
  clock: Clock
): Promise<void> {
  await browser.route('**/api.opensea.io/**', async (route) => {
    const path = new URL(route.request.url).pathname
    if (path.endsWith(`/${SLUG}/eligibility`)) {
      counters.eligibility += 1
      await route.fulfill({
        status: 200,
        json: {
          stages: [
            {
              stage_uuid: STAGE_UUID,
              is_eligible: true,
              max_total_mintable_by_wallet: '2',
              price: '0',
            },
          ],
        },
      })
      return
    }
    if (path.endsWith(`/${SLUG}/mint`)) {
      counters.mint += 1
      // Measured against live OpenSea: pre-open mint requests answer
      // 409 NOT_MINTING. The prepare phase must not treat that as calldata.
      if (
        clock.startMs === 0 ||
        Date.now() < clock.startMs + clock.mintDelayMs
      ) {
        await route.fulfill({
          status: 409,
          json: {
            errors: ['Drop is not currently active for minting'],
            code: 'NOT_MINTING',
          },
        })
        return
      }
      counters.mintOk += 1
      await route.fulfill({
        status: 200,
        json: { chain: 'robinhood', to: CONTRACT, data: '0x1234', value: '0' },
      })
      return
    }
    if (path.endsWith(`/${SLUG}`)) {
      counters.drop += 1
      if (clock.startMs === 0) clock.startMs = Date.now() + clock.leadMs
      await route.fulfill({
        status: 200,
        json: {
          collection_slug: SLUG,
          collection_name: 'Mock Drop',
          chain: 'robinhood',
          contract_address: CONTRACT,
          drop_type: 'seadrop_v1_erc721',
          is_minting: false,
          active_stage: null,
          next_stage: null,
          stages: [
            {
              uuid: STAGE_UUID,
              stage_type: 'public',
              label: 'Public',
              price: '0',
              max_per_wallet: '2',
              start_time: new Date(clock.startMs).toISOString(),
              end_time: new Date(clock.startMs + 3_600_000).toISOString(),
            },
          ],
        },
      })
      return
    }
    await route.abort()
  })
}

async function serveRpc(
  browser: Browser,
  clock: Clock,
  calls: { block: number[]; ethCall: number[]; send: number[] }
): Promise<void> {
  await browser.route(/^http:\/\/127\.0\.0\.1:8545(?:\/.*)?$/, async (route) => {
    const request = JSON.parse(route.request.postData ?? '{}') as {
      id?: number | string
      method?: string
      params?: unknown[]
    }
    const ok = (result: unknown) =>
      route.fulfill({
        status: 200,
        json: { jsonrpc: '2.0', id: request.id ?? null, result },
      })
    const fail = (code: number, message: string) =>
      route.fulfill({
        status: 200,
        json: {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: { code, message },
        },
      })

    switch (request.method) {
      case 'eth_getBlockByNumber':
        calls.block.push(Date.now())
        await ok({
          number: '0x1',
          hash: `0x${'11'.repeat(32)}`,
          parentHash: `0x${'22'.repeat(32)}`,
          nonce: '0x0000000000000000',
          mixHash: `0x${'33'.repeat(32)}`,
          sha3Uncles: `0x${'44'.repeat(32)}`,
          logsBloom: `0x${'00'.repeat(256)}`,
          transactionsRoot: `0x${'55'.repeat(32)}`,
          stateRoot: `0x${'66'.repeat(32)}`,
          receiptsRoot: `0x${'77'.repeat(32)}`,
          miner: `0x${'00'.repeat(20)}`,
          difficulty: '0x0',
          totalDifficulty: '0x0',
          extraData: '0x',
          size: '0x0',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
          transactions: [],
          uncles: [],
          baseFeePerGas: '0x3b9aca00',
        })
        return
      case 'eth_blockNumber':
        await ok('0x2')
        return
      case 'eth_call':
        calls.ethCall.push(Date.now())
        if (clock.startMs > 0 && Date.now() >= clock.startMs) {
          await ok('0x')
        } else {
          await fail(3, 'execution reverted: MintNotOpen')
        }
        return
      case 'eth_estimateGas':
        if (clock.startMs > 0 && Date.now() >= clock.startMs) {
          await ok('0x186a0')
        } else {
          await fail(3, 'execution reverted: MintNotOpen')
        }
        return
      case 'eth_getTransactionCount':
        await ok('0x0')
        return
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        await ok('0x3b9aca00')
        return
      case 'eth_feeHistory':
        await ok({
          oldestBlock: '0x1',
          baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
          gasUsedRatio: [0.5],
          reward: [['0x3b9aca00']],
        })
        return
      case 'eth_chainId':
        await ok('0x1237')
        return
      case 'eth_getBalance':
        await ok('0xde0b6b3a7640000')
        return
      case 'eth_getCode':
        await ok('0x')
        return
      case 'eth_sendRawTransaction':
        calls.send.push(Date.now())
        await ok(`0x${'aa'.repeat(32)}`)
        return
      case 'eth_getTransactionReceipt': {
        const hash = String(request.params?.[0] ?? `0x${'aa'.repeat(32)}`)
        await ok({
          transactionHash: hash,
          transactionIndex: '0x0',
          blockHash: `0x${'bb'.repeat(32)}`,
          blockNumber: '0x1',
          from: TEST_ACCOUNT.address,
          to: CONTRACT,
          cumulativeGasUsed: '0x186a0',
          gasUsed: '0x186a0',
          contractAddress: null,
          logs: [],
          logsBloom: `0x${'00'.repeat(256)}`,
          status: '0x1',
          type: '0x2',
          effectiveGasPrice: '0x3b9aca00',
        })
        return
      }
      default:
        await fail(-32601, `unexpected method ${request.method ?? 'none'}`)
    }
  })
}

async function openSeededTask(
  app: WebApp,
  browser: Browser,
  screen: Screen
): Promise<void> {
  await browser.addInitScript(() => {
    try {
      window.localStorage.setItem('wallet-chain', 'robinhood')
    } catch {}
  })

  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [FOLDER],
    wallets: [WALLET],
    connections: [
      robinhoodRpc('http://127.0.0.1:8545'),
      openseaConnection('deterministic-key'),
    ],
  })
  await app.open('/mint/tasks')

  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill(`https://opensea.io/collection/${SLUG}`)
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen.getByRole('checkbox', { name: 'Select all in Mock' }).click()
  await browser.keyboard.press('Escape')
}

async function checkOnce(screen: Screen): Promise<void> {
  await screen.getByRole('button', { name: 'Check' }).click()
  const row = screen.getByRole('row').filter({ hasText: 'mock' })
  await expect(row.getByText(TEST_ACCOUNT.address, { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible()
}

async function armMockStage(screen: Screen): Promise<number> {
  await screen.getByLabel('Mint Stage').click()
  await screen.getByRole('option', { name: 'Public' }).click()
  await expect(screen.getByLabel('Quantity')).toHaveValue('2')
  await screen.getByLabel('Quantity').fill('1')
  await expect(screen.getByLabel('Quantity')).toHaveValue('1')
  await screen.getByRole('button', { name: 'Advanced Gas' }).click()
  await screen.getByLabel('Max Fee (Gwei)').fill('1')
  await screen.getByLabel('Priority Fee (Gwei)').fill('0.1')

  const armedAt = Date.now()
  await screen.getByRole('button', { name: 'Start Mint' }).click()
  await expect(screen.getByText('Mint opens in')).toBeVisible({
    timeout: 10_000,
  })
  return armedAt
}

test('a second check reuses the SIWE token', async ({
  app,
  browser,
  screen,
}) => {
  const counters: Counters = {
    nonce: 0,
    token: 0,
    drop: 0,
    eligibility: 0,
    mint: 0,
    mintOk: 0,
  }
  const clock: Clock = { startMs: 0, leadMs: 15_000, mintDelayMs: 0 }
  await serveAuth(browser, counters)
  await serveOpenSea(browser, counters, clock)

  await openSeededTask(app, browser, screen)
  await checkOnce(screen)
  expect(counters.nonce).toBe(1)
  expect(counters.token).toBe(1)
  expect(counters.eligibility).toBe(1)

  await checkOnce(screen)
  await expect
    .poll(() => counters.eligibility, { timeout: 20_000 })
    .toBe(2)
  expect(counters.nonce, 'the cached token skipped the nonce call').toBe(1)
  expect(counters.token, 'the cached token skipped the token call').toBe(1)
})

test('the armed run prepares and fires near startMs', async ({
  app,
  browser,
  screen,
}) => {
  const counters: Counters = {
    nonce: 0,
    token: 0,
    drop: 0,
    eligibility: 0,
    mint: 0,
    mintOk: 0,
  }
  const clock: Clock = { startMs: 0, leadMs: 15_000, mintDelayMs: 0 }
  const calls = {
    block: [] as number[],
    ethCall: [] as number[],
    send: [] as number[],
  }
  await serveAuth(browser, counters)
  await serveOpenSea(browser, counters, clock)
  await serveRpc(browser, clock, calls)

  await openSeededTask(app, browser, screen)
  await checkOnce(screen)
  expect(clock.startMs, 'the drop response set a start time').toBeGreaterThan(0)

  const armedAt = await armMockStage(screen)

  await expect.poll(() => calls.send.length, { timeout: 40_000 }).toBe(1)
  await expect(screen.getByText('Confirmed', { exact: true }).first()).toBeVisible(
    { timeout: 30_000 }
  )

  expect(
    calls.ethCall.some((at) => at >= clock.startMs),
    'the readiness eth_call ran after the schedule opened'
  ).toBe(true)
  expect(
    calls.send[0],
    'the send happened after the scheduled open'
  ).toBeGreaterThanOrEqual(clock.startMs)
  expect(
    calls.send[0] - clock.startMs,
    'the send landed within 2.5 seconds of the open'
  ).toBeLessThan(2_500)

  const trace = await browser.evaluate<TraceEvent[]>(
    () => window.__veloxMintTrace?.snapshot() ?? []
  )

  const tight = trace.filter(
    (event) =>
      event.kind === 'poll' &&
      event.wall >= clock.startMs - 5_000 &&
      event.wall <= clock.startMs + 1_500
  )
  expect(
    tight.length,
    'the last five seconds polled more than a four-second timer would'
  ).toBeGreaterThanOrEqual(3)
  for (let index = 1; index < tight.length; index += 1) {
    expect(
      tight[index].wall - tight[index - 1].wall,
      'tight poll spacing'
    ).toBeLessThanOrEqual(1_000)
  }

  const calldata = trace.filter((event) => event.kind === 'calldata')
  expect(calldata.length, 'one open-time calldata response').toBe(1)
  expect(
    calldata[0].wall,
    'live OpenSea rejects pre-open calldata, so the fetch moved to the open'
  ).toBeGreaterThanOrEqual(clock.startMs)
  expect(counters.mintOk, 'one successful calldata response').toBe(1)

  const drops = trace.filter(
    (event) =>
      event.kind === 'drops' && event.wall >= armedAt && event.wall <= calls.send[0]
  )
  expect(drops.length, 'one drop read inside the armed fire').toBe(1)
})

test('a failed open-time calldata read backs off and recovers', async ({
  app,
  browser,
  screen,
}) => {
  const counters: Counters = {
    nonce: 0,
    token: 0,
    drop: 0,
    eligibility: 0,
    mint: 0,
    mintOk: 0,
  }
  const clock: Clock = {
    startMs: 0,
    leadMs: 15_000,
    mintDelayMs: 6_500,
  }
  const calls = {
    block: [] as number[],
    ethCall: [] as number[],
    send: [] as number[],
  }
  await serveAuth(browser, counters)
  await serveOpenSea(browser, counters, clock)
  await serveRpc(browser, clock, calls)

  await openSeededTask(app, browser, screen)
  await checkOnce(screen)
  await armMockStage(screen)

  await expect.poll(() => calls.send.length, { timeout: 40_000 }).toBe(1)
  const trace = await browser.evaluate<TraceEvent[]>(
    () => window.__veloxMintTrace?.snapshot() ?? []
  )
  const sendAt = calls.send[0]
  expect(
    sendAt - clock.startMs,
    'no send at the open while calldata was unavailable'
  ).toBeGreaterThan(5_000)
  expect(counters.mintOk, 'one successful calldata response').toBe(1)

  const calldata = trace.filter((event) => event.kind === 'calldata')
  expect(calldata.length, 'one successful calldata response').toBe(1)
  expect(
    calldata[0].wall - clock.startMs,
    'calldata was built after the provider opened'
  ).toBeGreaterThan(5_000)
  expect(
    calls.ethCall.every((at) => at - clock.startMs > 5_000),
    'no readiness call ran without calldata'
  ).toBe(true)

  const dropTimes = trace
    .filter(
      (event) =>
        event.kind === 'drops' &&
        event.wall >= clock.startMs &&
        event.wall <= sendAt
    )
    .map((event) => event.wall)
  expect(dropTimes.length, 'post-open retries backed off').toBeGreaterThanOrEqual(
    3
  )
  const gaps = dropTimes
    .slice(1)
    .map((at, index) => at - dropTimes[index])
  expect(gaps[0], 'first retry waited about a second').toBeGreaterThanOrEqual(700)
  expect(gaps[0]).toBeLessThan(2_000)
  expect(gaps[1], 'second retry waited about two seconds').toBeGreaterThanOrEqual(
    1_500
  )
  expect(gaps[1]).toBeLessThan(3_000)
  if (gaps[2] !== undefined) {
    expect(gaps[2], 'third retry capped at four seconds').toBeGreaterThanOrEqual(
      3_000
    )
    expect(gaps[2]).toBeLessThan(5_500)
  }
  expect(counters.eligibility, 'the open check was reused across retries').toBe(
    2
  )
})

test('a far-future arm sleeps instead of spinning', async ({
  app,
  browser,
  screen,
}) => {
  const counters: Counters = {
    nonce: 0,
    token: 0,
    drop: 0,
    eligibility: 0,
    mint: 0,
    mintOk: 0,
  }
  const clock: Clock = {
    startMs: 0,
    // Past the signed 32-bit setTimeout limit of about 24.8 days.
    leadMs: 30 * 24 * 60 * 60 * 1000,
    mintDelayMs: 0,
  }
  const calls = {
    block: [] as number[],
    ethCall: [] as number[],
    send: [] as number[],
  }
  await browser.addInitScript(() => {
    const original = window.setTimeout
    const delays: number[] = []
    ;(window as unknown as { __timerDelays: number[] }).__timerDelays = delays
    window.setTimeout = ((handler, timeout, ...args) => {
      if (typeof timeout === 'number') delays.push(timeout)
      return original(handler, timeout, ...args)
    }) as typeof window.setTimeout
  })
  await serveAuth(browser, counters)
  await serveOpenSea(browser, counters, clock)
  await serveRpc(browser, clock, calls)

  await openSeededTask(app, browser, screen)
  await checkOnce(screen)
  await armMockStage(screen)
  await new Promise((resolve) => setTimeout(resolve, 1_200))

  const delays = await browser.evaluate<number[]>(
    () =>
      (window as unknown as { __timerDelays?: number[] }).__timerDelays ?? []
  )
  expect(delays.length, 'the arm scheduled a sleep').toBeGreaterThan(0)
  expect(
    Math.max(...delays),
    'the arm sleep stays under the 32-bit timer limit'
  ).toBeLessThanOrEqual(60_000)
  expect(
    delays.filter((delay) => delay > 5_000).length,
    'a far-future arm does not wake in a tight loop'
  ).toBeLessThanOrEqual(10)
  expect(calls.send.length, 'a far-future arm did not send').toBe(0)

  const trace = await browser.evaluate<TraceEvent[]>(
    () => window.__veloxMintTrace?.snapshot() ?? []
  )
  expect(
    trace.filter((event) => event.kind === 'poll').length,
    'no tight chain polling thirty days out'
  ).toBeLessThanOrEqual(1)
})
