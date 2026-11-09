import type { Screen } from 'e2e'
import { expect } from 'e2e'
import type { Browser, WebApp } from '@e2e-dev/web'
import {
  openseaConnection,
  RH8_ADDRESS,
  RH8_FOLDER,
  rh8Wallet,
  robinhoodRpc,
} from './data'
import { requireEnv } from './env'
import { seedVelox } from './seed'

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
 * Seeds `rh8`, the Robinhood RPC row and the OpenSea key, then fills the mint
 * form until `Check` produces the run row. `status` is the row state this
 * scenario expects: `Eligible` when a stage is open, `Scheduled` otherwise.
 */
export async function prepareMintRun(options: {
  app: WebApp
  browser: Browser
  screen: Screen
  slug: string
  status: 'Eligible' | 'Scheduled'
}): Promise<void> {
  const { app, browser, screen, slug, status } = options

  await browser.addInitScript(() => {
    try {
      window.localStorage.setItem('wallet-chain', 'robinhood')
    } catch {}
  })

  await app.open('/mint/tasks')
  await seedVelox(browser, {
    folders: [RH8_FOLDER],
    wallets: [rh8Wallet(requireEnv('E2E_WALLET_RH8_KEY'))],
    connections: [
      robinhoodRpc(requireEnv('E2E_RH_RPC_URL')),
      openseaConnection(requireEnv('E2E_OPEN_SEA_KEY')),
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

  const row = screen.getByRole('row').filter({ hasText: 'rh8' })
  await expect(row.getByText(RH8_ADDRESS, { exact: true })).toBeVisible({
    timeout: 120_000,
  })
  await expect(row.getByText(status, { exact: true })).toBeVisible()
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
