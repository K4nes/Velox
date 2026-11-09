import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { RH8_ADDRESS } from '../../support/data'
import { requireEnv } from '../../support/env'
import {
  assertMintFunds,
  guardMintResponse,
  pinMintGas,
  prepareMintRun,
  readDrop,
  selectMintStage,
} from '../../support/mint'

const ready = Boolean(
  process.env.E2E_WALLET_RH8_KEY &&
    process.env.E2E_RH_RPC_URL &&
    process.env.E2E_OPEN_SEA_KEY,
)

test(
  'rh8 mints when the scheduled stage opens',
  { skip: ready ? false : 'set E2E_WALLET_RH8_KEY, E2E_RH_RPC_URL and E2E_OPEN_SEA_KEY' },
  async ({ app, browser, screen }) => {
    const slug = process.env.E2E_DROP_SLUG ?? 'bigfatfish'
    const lead = Number(process.env.E2E_MINT_LEAD_MINUTES ?? '35')
    const drop = await readDrop(slug)

    // The open scenario owns the live-stage case; arming needs a stage that
    // has not started yet.
    test.skip(drop.live, 'a stage is already open; tests/live/mint/open.e2e.ts covers the immediate run')
    expect(drop.future, 'a stage that has not opened yet').toBeTruthy()
    const stage = drop.future
    if (stage === null) {
      return
    }

    const delta = Date.parse(stage.start_time ?? '') - drop.now
    const opensIn = `${Math.round(delta / 60_000)} min`
    expect(delta, 'the stage already opened').toBeGreaterThan(0)
    // The form fill takes tens of seconds; a stage that opens mid-fill makes the
    // app mint at once, so `Mint opens in` never appears.
    expect(
      delta,
      `the stage opens in ${opensIn}; start the run at least 2 min before it`,
    ).toBeGreaterThanOrEqual(2 * 60_000)
    expect(
      delta,
      `the stage opens in ${opensIn}; run the test no more than ${lead} min before it`,
    ).toBeLessThanOrEqual((lead + 1) * 60_000)

    // Plan §9.4 guardrails: a surprise target or price fails before signing,
    // and the minter must cover the stage price plus gas.
    const guardMatched = await guardMintResponse({
      browser,
      contract: requireEnv('E2E_MINT_TO_CONTRACT'),
    })
    await assertMintFunds({
      rpcUrl: requireEnv('E2E_RH_RPC_URL'),
      address: RH8_ADDRESS,
      valueWei: BigInt(stage.price ?? '0'),
    })

    await prepareMintRun({ app, browser, screen, slug, status: 'Scheduled' })
    await selectMintStage(screen, drop.stages, stage)
    await screen.getByLabel('Quantity').fill('1')
    await pinMintGas(screen)
    await screen.getByRole('button', 'Start Mint').click()

    // A stage that opened while the form was being filled mints at once; only
    // the armed panel proves the arm-and-wait path.
    await expect(screen.getByText('Mint opens in')).toBeVisible({
      timeout: 30_000,
    })
    await expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible()

    await expect(
      screen.getByText('Confirmed', { exact: true }).first(),
    ).toBeVisible({ timeout: lead * 60_000 + 180_000 })
    await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(1)
    expect(
      guardMatched(),
      'the mint response was not intercepted; the guard checked nothing',
    ).toBe(true)
  },
)
