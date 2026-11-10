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
  'rh8 mints the open stage',
  { skip: ready ? false : 'set E2E_WALLET_RH8_KEY, E2E_RH_RPC_URL and E2E_OPEN_SEA_KEY' },
  async ({ app, browser, screen }) => {
    const slug = process.env.E2E_DROP_SLUG ?? 'bigfatfish'
    const drop = await readDrop(slug)

    // The scheduled scenario owns the future-stage case; here a stage must
    // already be open, otherwise `Start Mint` would arm instead of minting.
    test.skip(!drop.live, 'no stage is open; tests/live/mint/scheduled.e2e.ts covers the armed run')
    const stage = drop.active
    if (stage === null) {
      return
    }

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

    await prepareMintRun({ app, browser, screen, slug, status: 'Eligible' })
    await selectMintStage(screen, drop.stages, stage)
    await screen.getByLabel('Quantity').fill('1')
    await pinMintGas(screen)
    await screen.getByRole('button', 'Start Mint').click()

    await expect(
      screen.getByText('Confirmed', { exact: true }).first(),
    ).toBeVisible({ timeout: 180_000 })
    await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(1)
    expect(
      guardMatched(),
      'the mint response was not intercepted; the guard checked nothing',
    ).toBe(true)
  },
)
