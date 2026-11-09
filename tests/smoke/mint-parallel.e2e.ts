import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets } from '../support/data'
import {
  MINT_TEST_RPC_URL,
  mockMintNetwork,
  pinMintGas,
  prepareMintRun,
} from '../support/mint'
import type { MintEvent } from '../support/mint'

const SLUG = 'parallel-drop'
// The first wallet answers late enough that a serial loop would already have
// broadcast it before the second wallet's calldata request started.
const FIRST_CALLDATA_DELAY_MS = 800
const SECOND_CALLDATA_DELAY_MS = 1_600

type SendEvent = Extract<MintEvent, { kind: 'send' }>
type CalldataEvent = Extract<MintEvent, { kind: 'calldata' }>
type ReceiptEvent = Extract<MintEvent, { kind: 'receipt' }>

test('two wallets mint in parallel and settle once each', async ({
  app,
  browser,
  screen,
}) => {
  const [first, second] = mintWallets(2)
  const mock = await mockMintNetwork({
    browser,
    slug: SLUG,
    wallets: [
      { address: first.address, calldataDelayMs: FIRST_CALLDATA_DELAY_MS },
      { address: second.address, calldataDelayMs: SECOND_CALLDATA_DELAY_MS },
    ],
  })

  await prepareMintRun({
    app,
    browser,
    screen,
    slug: SLUG,
    status: 'Eligible',
    wallets: [first, second],
    rpcUrl: MINT_TEST_RPC_URL,
    apiKey: 'deterministic-key',
    addresses: [first.address, second.address],
  })

  await screen.getByLabel('Quantity').fill('1')
  await pinMintGas(screen)
  await screen.getByRole('button', 'Start Mint').click()

  await expect(screen.getByText('Confirmed', { exact: true })).toHaveCount(2, {
    timeout: 60_000,
  })

  const calldata = mock.events.filter(
    (event): event is CalldataEvent => event.kind === 'calldata',
  )
  const sends = mock.events.filter(
    (event): event is SendEvent => event.kind === 'send',
  )
  const receipts = mock.events.filter(
    (event): event is ReceiptEvent => event.kind === 'receipt',
  )
  const firstAddress = first.address.toLowerCase()
  const secondAddress = second.address.toLowerCase()

  // Parallel: the second wallet's calldata request is already open while the
  // first wallet is still waiting for its own response. Serial cannot do this.
  const secondCalldata = calldata.find(
    (event) => event.address === secondAddress,
  )
  const firstSend = sends.find((event) => event.address === firstAddress)
  expect(secondCalldata).toBeDefined()
  expect(firstSend).toBeDefined()
  expect(secondCalldata!.at).toBeLessThan(firstSend!.at)

  expect(sends).toHaveLength(2)
  expect(sends.map((event) => event.address)).toEqual([
    firstAddress,
    secondAddress,
  ])
  expect(new Set(sends.map((event) => event.txHash)).size).toBe(2)

  expect(receipts).toHaveLength(2)
  expect(new Set(receipts.map((event) => event.txHash)).size).toBe(2)
  expect(receipts.map((event) => event.txHash).sort()).toEqual(
    sends.map((event) => event.txHash).sort(),
  )
})
