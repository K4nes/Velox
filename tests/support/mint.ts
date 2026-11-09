import type { JsonValue, Screen } from 'e2e'
import { expect } from 'e2e'
import type { Browser, WebApp, WebRoute } from '@e2e-dev/web'
import { keccak256, recoverTransactionAddress } from 'viem'
import {
  openseaConnection,
  RH8_ADDRESS,
  RH8_FOLDER,
  rh8Wallet,
  robinhoodRpc,
} from './data'
import { requireEnv } from './env'
import { seedVelox } from './seed'
import type { WalletRow } from './seed'

/** One stage of a `/drops/{slug}` response, as far as the mint tests read it. */
export type DropStage = {
  label?: string
  start_time?: string
  end_time?: string
  max_per_wallet?: string
  price?: string
}

type Drop = {
  chain?: string
  drop_type?: string
  active_stage?: DropStage | null
  stages?: DropStage[]
}

export type DropState = {
  /** The stage OpenSea reports as active, or null when the drop is between stages. */
  active: DropStage | null
  /** True when `active` exists and has not ended. */
  live: boolean
  /** The first stage that starts after `now`, or null. */
  future: DropStage | null
  /** Every stage, sorted by start time: that is the order the `Mint Stage` list shows. */
  stages: DropStage[]
  /** The test machine's clock when the drop was read. */
  now: number
}

/** One request the mocked mint endpoints saw, in arrival order. */
export type MintEvent =
  | { kind: 'calldata'; address: string; at: number }
  | { kind: 'send'; address: string; txHash: string; at: number }
  | { kind: 'receipt'; txHash: string; at: number }

/** Seeded for deterministic runs; every request to it is answered in memory. */
export const MINT_TEST_RPC_URL = 'https://rpc.velox.test/robinhood'

const MINT_TEST_CONTRACT = '0x1111111111111111111111111111111111111111'

/**
 * Reads the drop over the public API with the seeded OpenSea key and sorts its
 * stages. Both mint scenarios decide from this whether they apply, so the
 * preflight runs before the browser starts a mint it cannot finish.
 */
export async function readDrop(slug: string): Promise<DropState> {
  const response = await fetch(`https://api.opensea.io/api/v2/drops/${slug}`, {
    headers: { 'x-api-key': requireEnv('E2E_OPEN_SEA_KEY') },
  })
  expect(response.status).toBe(200)
  const drop = (await response.json()) as Drop
  expect(drop.drop_type).toBe('seadrop_v1_erc721')
  expect(drop.chain).toBe('robinhood')

  const stages = [...(drop.stages ?? [])].sort(
    (a, b) => Date.parse(a.start_time ?? '') - Date.parse(b.start_time ?? ''),
  )
  const now = Date.now()
  const active = drop.active_stage ?? null
  const live = active !== null && Date.parse(active.end_time ?? '') > now
  const future =
    stages.find(
      (entry) => entry.start_time !== undefined && Date.parse(entry.start_time) > now,
    ) ?? null

  return { active, future, live, now, stages }
}

/**
 * Seeds the wallets, the Robinhood RPC row and the OpenSea key, then fills the
 * mint form until `Check` produces the run rows. `status` is the row state this
 * scenario expects: `Eligible` when a stage is open, `Scheduled` otherwise. The
 * default seed is the live `rh8` setup; a deterministic test passes its own
 * generated wallets and mocked endpoints.
 */
export async function prepareMintRun(options: {
  app: WebApp
  browser: Browser
  screen: Screen
  slug: string
  status: 'Eligible' | 'Scheduled'
  wallets?: WalletRow[]
  rpcUrl?: string
  apiKey?: string
  addresses?: string[]
}): Promise<void> {
  const { app, browser, screen, slug, status } = options
  const wallets =
    options.wallets ?? [rh8Wallet(requireEnv('E2E_WALLET_RH8_KEY'))]
  const addresses = options.addresses ?? [RH8_ADDRESS]

  await browser.addInitScript(() => {
    try {
      window.localStorage.setItem('wallet-chain', 'robinhood')
    } catch {}
  })

  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [RH8_FOLDER],
    wallets,
    connections: [
      robinhoodRpc(options.rpcUrl ?? requireEnv('E2E_RH_RPC_URL')),
      openseaConnection(options.apiKey ?? requireEnv('E2E_OPEN_SEA_KEY')),
    ],
  })
  await app.open('/mint/tasks')

  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill(`https://opensea.io/collection/${slug}`)

  // The wallet row lives in a collapsed group, so the group checkbox is the
  // way in; the picker closes on Escape.
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen.getByRole('checkbox', { name: 'Select all in Robinhood' }).click()
  await browser.keyboard.press('Escape')
  await screen.getByRole('button', 'Check').click()

  for (const address of addresses) {
    const row = screen.getByRole('row').filter({ hasText: address })
    await expect(row.getByText(address, { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await expect(row.getByText(status, { exact: true })).toBeVisible()
  }
}

/**
 * Answers the collection, drop, eligibility, mint, sign-in and chain endpoints
 * in memory, so a mint runs without keys or funds. `calldataDelayMs` holds that
 * wallet's mint response open, `sendDelayMs` its broadcast response, and
 * `receiptDelayMs` the receipt response; each makes one overlap assertion
 * observable. The events keep each request's arrival time.
 */
export async function mockMintNetwork(options: {
  browser: Browser
  slug: string
  wallets: { address: string; calldataDelayMs?: number; sendDelayMs?: number }[]
  receiptDelayMs?: number
}): Promise<{ events: MintEvent[] }> {
  const { browser, slug, receiptDelayMs = 0 } = options
  const events: MintEvent[] = []
  const delayByAddress = new Map(
    options.wallets.map((wallet) => [
      wallet.address.toLowerCase(),
      wallet.calldataDelayMs ?? 0,
    ])
  )
  const sendDelayByAddress = new Map(
    options.wallets.map((wallet) => [
      wallet.address.toLowerCase(),
      wallet.sendDelayMs ?? 0,
    ])
  )
  const now = Date.now()
  const stage = {
    uuid: 'parallel-stage',
    stage_type: 'public',
    label: 'Public',
    price: '0',
    max_per_wallet: '1',
    start_time: new Date(now - 60_000).toISOString(),
    end_time: new Date(now + 3_600_000).toISOString(),
  }

  async function answer(route: WebRoute, result: JsonValue) {
    const request = JSON.parse(route.request.postData ?? '{}') as { id?: JsonValue }
    await route.fulfill({
      status: 200,
      json: { jsonrpc: '2.0', id: request.id ?? null, result },
    })
  }

  async function handleRpc(route: WebRoute) {
    const request = JSON.parse(route.request.postData ?? '{}') as {
      id?: JsonValue
      method?: string
      params?: unknown[]
    }
    const params = request.params ?? []

    switch (request.method) {
      case 'eth_estimateGas':
        await answer(route, '0x30d40')
        return
      case 'eth_getBlockByNumber':
        await answer(route, {
          number: '0x1',
          hash: `0x${'00'.repeat(32)}`,
          parentHash: `0x${'00'.repeat(32)}`,
          nonce: '0x0000000000000000',
          sha3Uncles: `0x${'00'.repeat(32)}`,
          logsBloom: `0x${'00'.repeat(256)}`,
          transactionsRoot: `0x${'00'.repeat(32)}`,
          stateRoot: `0x${'00'.repeat(32)}`,
          receiptsRoot: `0x${'00'.repeat(32)}`,
          miner: MINT_TEST_CONTRACT,
          difficulty: '0x0',
          totalDifficulty: '0x0',
          extraData: '0x',
          size: '0x0',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          timestamp: '0x1',
          transactions: [],
          uncles: [],
          baseFeePerGas: '0x1',
          mixHash: `0x${'00'.repeat(32)}`,
        })
        return
      case 'eth_maxPriorityFeePerGas':
      case 'eth_gasPrice':
        await answer(route, '0x3b9aca00')
        return
      case 'eth_getTransactionCount':
        await answer(route, '0x0')
        return
      case 'eth_sendRawTransaction': {
        const serialized = params[0] as `0x${string}`
        const address = (
          await recoverTransactionAddress({ serializedTransaction: serialized })
        ).toLowerCase()
        const txHash = keccak256(serialized)
        events.push({ kind: 'send', address, txHash, at: Date.now() })
        const delayed = Promise.withResolvers<void>()
        setTimeout(delayed.resolve, sendDelayByAddress.get(address) ?? 0)
        await delayed.promise
        await answer(route, txHash)
        return
      }
      case 'eth_getTransactionReceipt': {
        const txHash = params[0] as string
        events.push({ kind: 'receipt', txHash, at: Date.now() })
        const delayed = Promise.withResolvers<void>()
        setTimeout(delayed.resolve, receiptDelayMs)
        await delayed.promise
        await answer(route, {
          transactionHash: txHash,
          transactionIndex: '0x0',
          blockHash: `0x${'00'.repeat(32)}`,
          blockNumber: '0x1',
          from: MINT_TEST_CONTRACT,
          to: MINT_TEST_CONTRACT,
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          contractAddress: null,
          logs: [],
          logsBloom: `0x${'00'.repeat(256)}`,
          status: '0x1',
          type: '0x2',
          effectiveGasPrice: '0x1',
        })
        return
      }
      default:
        await route.fulfill({
          status: 200,
          json: {
            jsonrpc: '2.0',
            id: request.id ?? null,
            error: {
              code: -32601,
              message: `unexpected RPC method ${request.method}`,
            },
          },
        })
    }
  }

  await browser.route(/\/api\/auth\/nonce$/, async (route) => {
    await route.fulfill({
      status: 200,
      json: { message: 'velox deterministic sign-in' },
    })
  })
  await browser.route(/\/api\/auth\/token$/, async (route) => {
    await route.fulfill({
      status: 200,
      json: { token: 'deterministic-token', expiresAt: Date.now() + 3_600_000 },
    })
  })
  await browser.route(/\/api\/v2\/collections\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        collection: slug,
        name: 'Parallel Drop',
        image_url: '',
        total_supply: 100,
        contracts: [{ address: MINT_TEST_CONTRACT, chain: 'robinhood' }],
      },
    })
  })
  await browser.route(/\/api\/v2\/drops\/[^/]+\/eligibility$/, async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        stages: [
          {
            stage_uuid: stage.uuid,
            is_eligible: true,
            max_total_mintable_by_wallet: '1',
            price: '0',
          },
        ],
      },
    })
  })
  await browser.route(/\/api\/v2\/drops\/[^/]+\/mint$/, async (route) => {
    const body = JSON.parse(route.request.postData ?? '{}') as {
      minter?: string
    }
    const address = (body.minter ?? '').toLowerCase()
    events.push({ kind: 'calldata', address, at: Date.now() })
    const delayed = Promise.withResolvers<void>()
    setTimeout(delayed.resolve, delayByAddress.get(address) ?? 0)
    await delayed.promise
    await route.fulfill({
      status: 200,
      json: {
        chain: 'robinhood',
        to: MINT_TEST_CONTRACT,
        data: '0x12345678',
        value: '0',
      },
    })
  })
  await browser.route(/\/api\/v2\/drops\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        collection_slug: slug,
        collection_name: 'Parallel Drop',
        chain: 'robinhood',
        contract_address: MINT_TEST_CONTRACT,
        drop_type: 'seadrop_v1_erc721',
        is_minting: true,
        max_supply: '100',
        total_supply: '0',
        active_stage: stage,
        stages: [stage],
      },
    })
  })
  await browser.route(/rpc\.velox\.test/, handleRpc)

  return { events }
}

/**
 * Picks `stage` in the `Mint Stage` list. The options carry the drop's labels,
 * which can be blank on OpenSea, so an empty label falls back to the index in
 * the start-time-sorted list.
 */
export async function selectMintStage(
  screen: Screen,
  stages: DropStage[],
  stage: DropStage,
): Promise<void> {
  const label = stage.label ?? ''
  const index = stages.findIndex(
    (entry) =>
      entry.start_time === stage.start_time && (entry.label ?? '') === label,
  )

  await screen.getByLabel('Mint Stage').click()
  if (label !== '') {
    await screen.getByRole('option', { name: label }).click()
  } else {
    await screen.getByRole('option').nth(index).click()
  }
}

/** The free Public stage sends value 0; a paid drop overrides the ceiling. */
function maxMintValueWei(): bigint {
  return BigInt(process.env.E2E_MAX_MINT_VALUE_WEI ?? '0')
}

/** 0.0001 ETH: several times a 100k-gas mint at a few gwei. */
const MINT_GAS_BUFFER_WEI = 100_000_000_000_000n

/**
 * Reads the mint response without deciding the route, so a surprise target or
 * price fails the test before the app signs it. `route.fetch()` keeps the real
 * request and the app still receives the provider's own body.
 */
export async function guardMintResponse(options: {
  browser: Browser
  contract: string
}): Promise<() => boolean> {
  let matched = false
  await options.browser.route(
    '**/api.opensea.io/api/v2/drops/*/mint',
    async (route) => {
      matched = true
      const upstream = await route.fetch()
      const body = (await upstream.json()) as {
        chain?: string
        to?: string
        value?: string
      }
      const contract = options.contract.toLowerCase()

      expect(upstream.status, 'the mint provider refused the request').toBe(200)
      expect(body.chain).toBe('robinhood')
      expect(
        (body.to ?? '').toLowerCase(),
        `the mint targets ${body.to}; expected ${options.contract}`,
      ).toBe(contract)

      const value = BigInt(body.value ?? '0')
      const cap = maxMintValueWei()
      expect(
        value <= cap,
        `the mint costs ${value} wei; the guard allows ${cap}`,
      ).toBe(true)

      await route.fulfill({ status: upstream.status, json: body })
    },
  )
  return () => matched
}

/**
 * Reads the minter's balance through the seeded RPC and checks it covers the
 * stage price plus a gas buffer; the app would otherwise fail at broadcast with
 * an RPC error that reads like a test bug.
 */
export async function assertMintFunds(options: {
  rpcUrl: string
  address: string
  valueWei: bigint
}): Promise<void> {
  const response = await fetch(options.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [options.address, 'latest'],
    }),
  })
  const payload = (await response.json()) as {
    result?: string
    error?: { message?: string }
  }
  expect(
    payload.error,
    `the balance read failed: ${payload.error?.message}`,
  ).toBeUndefined()

  const balance = BigInt(payload.result ?? '0')
  const needed = options.valueWei + MINT_GAS_BUFFER_WEI
  expect(
    balance >= needed,
    `${options.address} holds ${balance} wei; the mint needs ${needed}`,
  ).toBe(true)
}

/**
 * Pins the fee fields so the run has a known ceiling instead of whatever the
 * fee market returns at broadcast time.
 */
export async function pinMintGas(screen: Screen): Promise<void> {
  await screen.getByRole('button', { name: 'Advanced Gas' }).click()
  await screen.getByLabel('Max Fee (Gwei)').fill('1')
  await screen.getByLabel('Priority Fee (Gwei)').fill('0.1')
}
