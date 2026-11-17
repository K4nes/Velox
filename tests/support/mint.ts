import type { JsonValue, Screen } from 'e2e'
import { expect } from 'e2e'
import type { Browser, WebApp, WebRoute } from '@e2e-dev/web'
import { keccak256, parseTransaction, recoverTransactionAddress } from 'viem'
import type { TransactionSerialized } from 'viem'
import {
  mintWallets,
  pinWalletChain,
  openseaConnection,
  robinhoodRpc,
  walletFolder,
  walletRow,
} from './data'
import { requireEnv } from './env'
import { seedVelox } from './seed'
import type { FolderRow, WalletRow } from './seed'

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

/** One request the mocked mint endpoints saw, in arrival order. A send names the
 * transaction target and its calldata, so a test can tell an approval from a mint. */
export type MintEvent =
  | { kind: 'calldata'; address: string; at: number }
  | {
      kind: 'send'
      address: string
      txHash: string
      to: string
      data: string
      at: number
    }
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

  return { stages, active, live, future, now }
}

/**
 * Seeds the wallets, the Robinhood RPC row and the OpenSea key, then fills the
 * mint form until `Check` produces the run rows. `status` is the row state this
 * scenario expects: `Eligible` when a stage is open, `Scheduled` otherwise. The
 * default seed is the env-supplied live wallet; a deterministic test passes its
 * own generated wallets, folder and mocked endpoints.
 */
export async function prepareMintRun(options: {
  app: WebApp
  browser: Browser
  screen: Screen
  slug: string
  status: 'Eligible' | 'Scheduled'
  folder?: FolderRow
  wallets?: WalletRow[]
  rpcUrl?: string
  apiKey?: string
  addresses?: string[]
}): Promise<void> {
  const { app, browser, screen, slug, status } = options
  const folder =
    options.folder ?? walletFolder(requireEnv('E2E_WALLET_FOLDER'))
  const wallets =
    options.wallets ??
    [
      walletRow({
        label: requireEnv('E2E_WALLET_LABEL'),
        privateKey: requireEnv('E2E_WALLET_KEY'),
        folderId: folder.id,
      }),
    ]
  const addresses = options.addresses ?? wallets.map((wallet) => wallet.address)

  await pinWalletChain(browser)

  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [folder],
    wallets,
    connections: [
      robinhoodRpc(options.rpcUrl ?? requireEnv('E2E_RH_RPC_URL')),
      openseaConnection(options.apiKey ?? requireEnv('E2E_OPEN_SEA_KEY')),
    ],
  })
  await app.open('/mint/tasks')

  await checkCollection(
    browser,
    screen,
    folder,
    `https://opensea.io/collection/${slug}`
  )

  for (const address of addresses) {
    const row = screen.getByRole('row').filter({ hasText: address })
    await expect(row.getByText(address, { exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await expect(row.getByText(status, { exact: true })).toBeVisible()
  }
}

/** One `eth_call` the mocked chain saw. `selector` proves which read was made. */
export type MintCall = { to: string; selector: string }

/**
 * Answers the chain's JSON-RPC in memory, so a mint broadcasts and settles without a
 * node. `sendDelayMs` holds that wallet's broadcast open and `receiptDelayMs` the
 * receipt, which makes one overlap assertion observable. `revert` answers a failed
 * receipt, so a test can prove a reverted send is not a landing; `revertTo` fails only
 * the receipts for a send to a listed target, so an approval and the mint behind it can
 * settle differently. The events keep each request's arrival time, and `calls` records
 * each `eth_call` by target and selector so a native test can prove no allowance read
 * happened. Token balances and allowances are answered from the base-unit values a test
 * states; an unmatched call reads zero.
 */
export async function mockMintRpc(options: {
  browser: Browser
  wallets: { address: string; sendDelayMs?: number }[]
  receiptDelayMs?: number
  nowMs?: number
  revert?: boolean
  // Answers every `eth_call` with a JSON-RPC error, so a failed allowance read is
  // observable without a second route.
  callError?: string
  // The on-chain symbol/decimals a token states, which a build without payment
  // metadata leaves to the chain.
  tokenMetadata?: { token: string; symbol: string; decimals: number }[]
  revertTo?: string[]
  tokenBalances?: { token: string; owner: string; balance: string }[]
  tokenAllowances?: { token: string; owner: string; spender: string; allowance: string }[]
}): Promise<{ events: MintEvent[]; calls: MintCall[] }> {
  const receiptDelayMs = options.receiptDelayMs ?? 0
  const nowMs = options.nowMs ?? Date.now()
  const events: MintEvent[] = []
  const calls: MintCall[] = []
  const metadataByToken = new Map(
    (options.tokenMetadata ?? []).map((entry) => [
      entry.token.toLowerCase(),
      entry,
    ])
  )
  const revertTo = new Set((options.revertTo ?? []).map((to) => to.toLowerCase()))
  // The receipt states no target of its own, so the send that produced the hash is the
  // only source for whether that transaction reverts.
  const sendTargets = new Map<string, string>()
  const balanceByKey = new Map(
    (options.tokenBalances ?? []).map((entry) => [
      `${entry.token.toLowerCase()}:${entry.owner.toLowerCase()}`,
      entry.balance,
    ])
  )
  const allowanceByKey = new Map(
    (options.tokenAllowances ?? []).map((entry) => [
      `${entry.token.toLowerCase()}:${entry.owner.toLowerCase()}:${entry.spender.toLowerCase()}`,
      entry.allowance,
    ])
  )
  const sendDelayByAddress = new Map(
    options.wallets.map((wallet) => [
      wallet.address.toLowerCase(),
      wallet.sendDelayMs ?? 0,
    ])
  )

  // ABI-encoded `string`, the shape a token's `symbol()` answer takes.
  function abiString(value: string): string {
    const bytes = new TextEncoder().encode(value)
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    const offset = (32).toString(16).padStart(64, '0')
    const length = bytes.length.toString(16).padStart(64, '0')
    const padded = hex.padEnd(Math.ceil(bytes.length / 32) * 64, '0')
    return `0x${offset}${length}${padded}`
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
          timestamp: `0x${Math.floor(nowMs / 1000).toString(16)}`,
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
        const serialized = params[0] as TransactionSerialized
        const address = (
          await recoverTransactionAddress({ serializedTransaction: serialized })
        ).toLowerCase()
        const transaction = parseTransaction(serialized)
        const to = (transaction.to ?? '').toLowerCase()
        const txHash = keccak256(serialized)
        events.push({
          kind: 'send',
          address,
          txHash,
          to,
          data: transaction.data ?? '0x',
          at: Date.now(),
        })
        sendTargets.set(txHash.toLowerCase(), to)
        const delayed = Promise.withResolvers<void>()
        setTimeout(delayed.resolve, sendDelayByAddress.get(address) ?? 0)
        await delayed.promise
        await answer(route, txHash)
        return
      }
      case 'eth_getTransactionReceipt': {
        const txHash = params[0] as string
        events.push({ kind: 'receipt', txHash, at: Date.now() })
        const target = sendTargets.get(txHash.toLowerCase())
        const reverted =
          options.revert === true ||
          (target !== undefined && revertTo.has(target))
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
          status: reverted ? '0x0' : '0x1',
          type: '0x2',
          effectiveGasPrice: '0x1',
        })
        return
      }
      case 'eth_call': {
        const call = (params[0] ?? {}) as { to?: string; data?: string }
        const to = (call.to ?? '').toLowerCase()
        const data = call.data ?? ''
        const selector = data.slice(0, 10)
        calls.push({ to, selector })
        if (options.callError !== undefined) {
          await route.fulfill({
            status: 200,
            json: {
              jsonrpc: '2.0',
              id: request.id ?? null,
              error: { code: -32000, message: options.callError },
            },
          })
          return
        }
        const metadata = metadataByToken.get(to)
        if (selector === '0x95d89b41' && metadata !== undefined) {
          await answer(route, abiString(metadata.symbol))
          return
        }
        if (selector === '0x313ce567' && metadata !== undefined) {
          await answer(
            route,
            `0x${BigInt(metadata.decimals).toString(16).padStart(64, '0')}`
          )
          return
        }
        let value = '0'
        if (selector === '0x70a08231') {
          const owner = `0x${data.slice(34, 74)}`.toLowerCase()
          value = balanceByKey.get(`${to}:${owner}`) ?? '0'
        } else if (selector === '0xdd62ed3e') {
          const owner = `0x${data.slice(34, 74)}`.toLowerCase()
          const spender = `0x${data.slice(98, 138)}`.toLowerCase()
          value = allowanceByKey.get(`${to}:${owner}:${spender}`) ?? '0'
        }
        await answer(route, `0x${BigInt(value).toString(16).padStart(64, '0')}`)
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

  await options.browser.route(/rpc\.velox\.test/, handleRpc)

  return { events, calls }
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
  /** The stage's stated per-wallet cap, on the drop and in the eligibility answer. */
  maxPerWallet?: string
  /** The stage's price in base units. OpenSea carries its price as wei. */
  priceWei?: string
}): Promise<{ events: MintEvent[] }> {
  // The chain is the same for every provider, so the RPC mock is shared.
  const rpc = await mockMintRpc({
    browser: options.browser,
    wallets: options.wallets.map((wallet) => ({
      address: wallet.address,
      sendDelayMs: wallet.sendDelayMs,
    })),
    receiptDelayMs: options.receiptDelayMs ?? 0,
  })
  const { browser, slug } = options
  const maxPerWallet = options.maxPerWallet ?? '1'
  const priceWei = options.priceWei ?? '0'
  const delayByAddress = new Map(
    options.wallets.map((wallet) => [
      wallet.address.toLowerCase(),
      wallet.calldataDelayMs ?? 0,
    ])
  )
  const now = Date.now()
  const stage = {
    uuid: 'parallel-stage',
    stage_type: 'public',
    label: 'Public',
    price: priceWei,
    max_per_wallet: maxPerWallet,
    start_time: new Date(now - 60_000).toISOString(),
    end_time: new Date(now + 3_600_000).toISOString(),
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
            max_total_mintable_by_wallet: maxPerWallet,
            price: priceWei,
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
    rpc.events.push({ kind: 'calldata', address, at: Date.now() })
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
  return rpc
}

export async function seedMintPage(
  app: WebApp,
  browser: Browser,
  folder: FolderRow,
  wallets: WalletRow[],
): Promise<void> {
  await pinWalletChain(browser)
  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [folder],
    wallets,
    connections: [
      robinhoodRpc(MINT_TEST_RPC_URL),
      openseaConnection('deterministic-key'),
    ],
  })
  await app.open('/mint/tasks')
}

export async function selectFolder(
  browser: Browser,
  screen: Screen,
  folder: FolderRow,
): Promise<void> {
  // The wallet row lives in a collapsed group, so the group checkbox is the
  // way in; the picker closes on Escape.
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
}

export async function checkCollection(
  browser: Browser,
  screen: Screen,
  folder: FolderRow,
  url: string,
): Promise<void> {
  await screen
    .getByLabel('Collection URL or slug (OpenSea / Scatter)')
    .fill(url)
  await selectFolder(browser, screen, folder)
  await screen.getByRole('button', { name: 'Check' }).click()
}

export async function waitForEligible(
  screen: Screen,
  count: number,
): Promise<void> {
  await expect(screen.getByText('Eligible', { exact: true })).toHaveCount(count, {
    timeout: 60_000,
  })
}

export function oneWallet(folder: FolderRow): WalletRow {
  const wallet = mintWallets(1, folder.id)[0]
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')
  return wallet
}

const SUMMARY_BOX =
  "//span[normalize-space()='Quantity per Wallet']/parent::div/parent::div"

/** The four-row summary block, anchored on its first label. */
export function summaryBox(browser: Browser) {
  return browser.locator(`xpath=${SUMMARY_BOX}`)
}

/** The summary rows as `label: value`, in render order. */
export async function summaryLines(browser: Browser): Promise<string[]> {
  const rows = browser.locator(`xpath=${SUMMARY_BOX}/div`)
  const count = await rows.count()
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) {
    const label = await browser
      .locator(`xpath=${SUMMARY_BOX}/div[${index + 1}]/span[1]`)
      .textContent()
    const value = await browser
      .locator(`xpath=${SUMMARY_BOX}/div[${index + 1}]/span[2]`)
      .textContent()
    lines.push(`${label ?? ''}: ${value ?? ''}`)
  }
  return lines
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
      const upstream = await route.fetch()
      const body = (await upstream.json().catch(() => ({}))) as {
        chain?: string
        to?: string
        value?: string
      }

      // The armed path asks for calldata before the open. OpenSea rejects that
      // with 409 NOT_MINTING; it is not the successful response under test.
      if (upstream.status === 409) {
        await route.fulfill({ status: 409, json: body })
        return
      }

      matched = true
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

/** Scatter's sentinel for "no end" and "no limit": Unix `0xffffffff`. */
export const SCATTER_OPEN_END = '2106-02-07T06:28:15.000Z'
export const SCATTER_NO_LIMIT = 4294967295
export const SCATTER_CONTRACT = '0x2222222222222222222222222222222222222222'

/** One mint list as the Scatter API states it; defaults are a live, capped public list. */
export type ScatterList = {
  id: string
  name: string
  /** Granted to named minters only, so a bare read never returns it. */
  private?: boolean
  price?: string
  currencySymbol?: string
  currencyAddress?: string
  decimals?: number
  startTime?: string
  endTime?: string
  walletLimit?: number
  listLimit?: number
  unitSize?: number
}

/** One mint build as the Scatter API states it: unsigned calldata plus every token
 * allowance the list wants. A native-currency list states none. `listPayments` names the
 * token's symbol and decimals, which is the only display metadata a build carries. */
export type ScatterMintAnswer = {
  to?: string
  data?: string
  value?: string
  erc20s?: { address: string; amount: string }[]
  listPayments?: {
    currencyAddress: string
    currencySymbol: string
    currencyDecimals: number
    unitPaymentValue: string
  }[]
}

/** A mint build the mocked Scatter API saw, parsed. */
export type ScatterMintBody = {
  collectionAddress?: string
  chainId?: number
  minterAddress?: string
  lists?: { id: string; quantity: number; tokenId?: number }[]
}

/** A refusal the mocked mint route answers instead of a build. */
export type ScatterMintRefusal = { status: number; body: JsonValue }

/** What the mocked Scatter API saw, in arrival order. */
export type ScatterCalls = {
  collections: string[]
  lists: { slug: string; minter: string | null; at: number }[]
  mintBodies: ScatterMintBody[]
}

/**
 * Answers Scatter's collection, eligible-invite-lists and mint endpoints in memory. A
 * bare read returns the public lists only, which is the live contract; a minter read
 * adds the private lists `eligible` names for that address. `failMinters` fails one
 * address's read, so a test can prove the failure stays on its own row. The mint route
 * records the body it was given and answers with `mint`, so a test states the
 * transaction and the allowances it wants to see refused.
 */
export async function mockScatterNetwork(options: {
  browser: Browser
  slug: string
  chainId?: number
  // The collection every answer describes. A test that needs another address names it.
  collectionAddress?: string
  lists: ScatterList[]
  eligible?: (minter: string | null) => string[]
  failMinters?: string[]
  // A wallet's own answer can differ: the allowance a build asks for is stated per build.
  mint?: ScatterMintAnswer | ((body: ScatterMintBody) => ScatterMintAnswer)
  // A refusal the build answers instead of calldata, such as a missing token ID.
  refuseMint?: (body: ScatterMintBody) => ScatterMintRefusal | null
  // Holds every build response open, so the stage probe's pending state is observable.
  mintDelayMs?: number
}): Promise<ScatterCalls> {
  const calls: ScatterCalls = { collections: [], lists: [], mintBodies: [] }
  const { lists } = options
  const publicLists = lists.filter((list) => list.private !== true)
  const collectionAddress = options.collectionAddress ?? SCATTER_CONTRACT
  const now = Date.now()

  function visibleLists(minter: string | null): ScatterList[] {
    if (minter === null) return publicLists
    const granted = new Set(options.eligible?.(minter) ?? [])
    return lists.filter((list) => list.private !== true || granted.has(list.id))
  }

  function refused(minter: string | null): boolean {
    if (minter === null) return false
    const address = minter.toLowerCase()
    return (options.failMinters ?? []).some(
      (failed) => failed.toLowerCase() === address,
    )
  }

  function body(list: ScatterList) {
    return {
      id: list.id,
      root: `0x${'00'.repeat(32)}`,
      address: collectionAddress,
      name: list.name,
      currency_address:
        list.currencyAddress ?? '0x0000000000000000000000000000000000000000',
      currency_symbol: list.currencySymbol ?? 'ETH',
      token_price: list.price ?? '0.01',
      decimals: list.decimals ?? 18,
      start_time: list.startTime ?? new Date(now - 60_000).toISOString(),
      end_time: list.endTime ?? new Date(now + 3_600_000).toISOString(),
      wallet_limit: list.walletLimit ?? 1,
      list_limit: list.listLimit ?? SCATTER_NO_LIMIT,
      unit_size: list.unitSize ?? 1,
    }
  }

  await options.browser.route(
    /api\.scatter\.art\/v1\/collection\/[^/?]+\/eligible-invite-lists/,
    async (route) => {
      const url = new URL(route.request.url)
      const slug = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      const minter = url.searchParams.get('minterAddress')
      // Recorded before the failure branch, so a refused read still proves it happened.
      calls.lists.push({ slug, minter, at: Date.now() })
      if (refused(minter)) {
        await route.fulfill({
          status: 500,
          json: { error: 'Scatter list read failed' },
        })
        return
      }
      await route.fulfill({
        status: 200,
        json: visibleLists(minter).map(body),
      })
    },
  )

  await options.browser.route(
    /api\.scatter\.art\/v1\/collection\/[^/?]+$/,
    async (route) => {
      const url = new URL(route.request.url)
      const slug = decodeURIComponent(url.pathname.split('/').at(-1) ?? '')
      calls.collections.push(slug)
      await route.fulfill({
        status: 200,
        json: {
          id: slug,
          name: 'Scatter Drop',
          symbol: 'SD',
          address: collectionAddress,
          chain_id: options.chainId ?? 4663,
          avatar_uri: '',
          banner_uri: '',
          description: '',
          max_items: 100,
          num_items: 0,
          num_owners: 0,
        },
      })
    },
  )

  // The build is unsigned calldata the client signs locally. A one-entry `lists` body
  // is the only shape Velox sends, so the mock states the same contract it answers.
  await options.browser.route(/api\.scatter\.art\/v1\/mint$/, async (route) => {
    const body = JSON.parse(route.request.postData ?? '{}') as ScatterMintBody
    calls.mintBodies.push(body)
    if (options.mintDelayMs) {
      const delayed = Promise.withResolvers<void>()
      setTimeout(delayed.resolve, options.mintDelayMs)
      await delayed.promise
    }
    const refusal = options.refuseMint?.(body)
    if (refusal) {
      await route.fulfill({ status: refusal.status, json: refusal.body })
      return
    }
    const answer =
      typeof options.mint === 'function' ? options.mint(body) : options.mint
    await route.fulfill({
      status: 200,
      json: {
        mintTransaction: {
          to: answer?.to ?? collectionAddress,
          data: answer?.data ?? '0x4a21a2df',
          value: answer?.value ?? '0',
        },
        erc20s: answer?.erc20s ?? [],
        listPayments: answer?.listPayments ?? [],
      },
    })
  })

  return calls
}
