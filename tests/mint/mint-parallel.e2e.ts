import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, secondWallet, walletFolder } from '../support/data'
import { requireEnv } from '../support/env'
import {
  MINT_TEST_RPC_URL,
  mockMintNetwork,
  pinMintGas,
  prepareMintRun,
} from '../support/mint'
import type { MintEvent } from '../support/mint'

const SLUG = 'parallel-drop'
// Holding the first wallet's mint response open lets a parallel run record the
// second wallet's calldata request before the first send; serial starts the
// second request only after that send, so it fails the overlap assertion.
const FIRST_CALLDATA_DELAY_MS = 800
const SECOND_CALLDATA_DELAY_MS = 1_600
// The first send stays open past the second send's arrival; serialized sends
// make the second request wait for this response instead.
const FIRST_SEND_DELAY_MS = 2_000
// Both receipt requests must leave before either answer returns; serial waits
// for the first receipt before it starts the second request.
const RECEIPT_DELAY_MS = 800

type SendEvent = Extract<MintEvent, { kind: 'send' }>
type CalldataEvent = Extract<MintEvent, { kind: 'calldata' }>
type ReceiptEvent = Extract<MintEvent, { kind: 'receipt' }>

test('two wallets mint in parallel and settle once each', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Mint')
  const [first] = mintWallets(1, folder.id)
  const second = secondWallet(requireEnv('E2E_WALLET_SECOND_KEY'), folder.id)
  const mock = await mockMintNetwork({
    browser,
    slug: SLUG,
    wallets: [
      {
        address: first.address,
        calldataDelayMs: FIRST_CALLDATA_DELAY_MS,
        sendDelayMs: FIRST_SEND_DELAY_MS,
      },
      { address: second.address, calldataDelayMs: SECOND_CALLDATA_DELAY_MS },
    ],
    receiptDelayMs: RECEIPT_DELAY_MS,
  })

  await prepareMintRun({
    app,
    browser,
    screen,
    slug: SLUG,
    status: 'Eligible',
    folder,
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
  // The second send leaves while the first response is still held open. A
  // serialized send waits for that response, so the gap reaches the delay.
  expect(sends[1].at - sends[0].at).toBeLessThan(FIRST_SEND_DELAY_MS)

  expect(receipts).toHaveLength(2)
  expect(new Set(receipts.map((event) => event.txHash)).size).toBe(2)
  expect(receipts.map((event) => event.txHash).sort()).toEqual(
    sends.map((event) => event.txHash).sort(),
  )
  // A serial confirm loop issues the second request only after the first
  // answer returns, which the delay makes larger than the gap here.
  expect(receipts[1].at - receipts[0].at).toBeLessThan(RECEIPT_DELAY_MS)
})
