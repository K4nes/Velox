import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { customRpc, mintWallets, walletFolder } from '../support/data'
import { mockRpc, word } from '../support/rpc'
import { seedVelox } from '../support/seed'

const RPC_URL = 'http://127.0.0.1:8545'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const BALANCE = 10n ** 18n

test('a funded wallet gets a quote and an enabled swap', async ({
  app,
  browser,
  screen,
}) => {
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545(?:\/.*)?$/,
    chainId: '0x1',
    ethCall: { '0x70a08231': word(BALANCE) },
  })

  await browser.route('**/api.relay.link/quote/v2', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        requestId: 'e2e-swap-quote',
        details: {
          operation: 'wrap',
          currencyOut: {
            amount: '100000000000000000',
            minimumAmount: '99000000000000000',
          },
        },
        steps: [
          {
            kind: 'transaction',
            id: 'deposit',
            items: [
              {
                data: { to: WETH, data: '0x1234', value: '0', chainId: 1 },
                check: {},
              },
            ],
          },
        ],
      },
    })
  })

  const folder = walletFolder('Swap')
  const [wallet] = mintWallets(1, folder.id)
  if (!wallet) throw new Error('mintWallets(1) returned no wallet')

  await app.open('/swap')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [customRpc('ethereum', RPC_URL)],
  })
  await app.open('/swap')

  await expect(screen.getByText('WETH → ETH')).toBeVisible()
  await expect(
    screen.getByRole('button', { name: 'Select wallets to swap' })
  ).toBeDisabled()

  await screen
    .getByRole('button', { name: /Select wallets \(\d+ selected\)/ })
    .click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')
  await screen.getByLabel(`Amount for ${wallet.label}`).fill('0.1')

  await expect(screen.getByText(/^≈ 0\.1 ETH$/)).toBeVisible()
  await expect(
    screen.getByRole('button', { name: 'Swap 1 wallet' })
  ).toBeEnabled()
  expect(rpc.count('eth_sendRawTransaction'), 'the preview must not write').toBe(
    0
  )
})

test('page state survives a round trip through another page', async ({
  app,
  browser,
  screen,
}) => {
  const rpc = await mockRpc(browser, {
    url: /^http:\/\/127\.0\.0\.1:8545(?:\/.*)?$/,
    chainId: '0x1',
    ethCall: { '0x70a08231': word(BALANCE) },
    allowWrites: true,
  })

  // The quote answers only when the test releases it, so the run is still quoting
  // while the operator visits another page.
  const released = Promise.withResolvers<void>()
  let holdQuote = false

  await browser.route('**/api.relay.link/quote/v2', async (route) => {
    if (holdQuote) await released.promise
    await route.fulfill({
      status: 200,
      json: {
        requestId: 'e2e-swap-keep',
        details: {
          operation: 'wrap',
          currencyOut: {
            amount: '100000000000000000',
            minimumAmount: '99000000000000000',
          },
        },
        steps: [
          {
            kind: 'transaction',
            id: 'deposit',
            items: [
              {
                data: { to: WETH, data: '0x1234', value: '0', chainId: 1 },
              },
            ],
          },
        ],
      },
    })
  })
  // Relay learns about a deposit from this call; nothing reads its body.
  await browser.route('**/api.relay.link/transactions/**', (route) =>
    route.fulfill({ status: 200, json: {} })
  )

  const folder = walletFolder('Swap Keep')
  const [wallet] = mintWallets(1, folder.id)
  if (wallet === undefined) throw new Error('mintWallets(1) returned no wallet')

  await app.open('/swap')
  await seedVelox(browser, {
    folders: [folder],
    wallets: [wallet],
    connections: [customRpc('ethereum', RPC_URL)],
  })
  await app.open('/swap')

  await screen
    .getByRole('button', { name: /Select wallets \(\d+ selected\)/ })
    .click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .click()
  await browser.keyboard.press('Escape')

  const destination = screen.getByRole('combobox', {
    name: 'Destination chain',
  })
  await destination.click()
  await screen.getByRole('option', { name: 'Base' }).click()
  const slippage = screen.getByRole('combobox', {
    name: 'Slippage tolerance',
  })
  await slippage.click()
  await screen.getByRole('option', { name: '1%' }).click()
  await screen.getByLabel(`Amount for ${wallet.label}`).fill('0.1')

  await expect(
    screen.getByText('WETH → ETH · Ethereum → Base'),
  ).toBeVisible()
  await expect(screen.getByText(/^≈ 0\.1 ETH$/)).toBeVisible()
  await expect(
    screen.getByRole('button', { name: 'Swap 1 wallet' }),
  ).toBeEnabled()

  await screen.getByRole('link', { name: 'Settings' }).click()
  await expect(
    screen.getByRole('combobox', { name: 'Origin chain' }),
  ).toHaveCount(0)
  await screen.getByRole('link', { name: 'Swap' }).click()

  await expect(
    screen.getByRole('button', { name: /Select wallets/ }),
  ).toHaveText('Select wallets (1 selected)')
  await expect(
    screen.getByRole('combobox', { name: 'Origin chain' }),
  ).toHaveText('Ethereum')
  await expect(destination).toHaveText('Base')
  await expect(
    screen.getByRole('combobox', { name: 'Sell asset' }),
  ).toHaveText('WETH · Wrapped Ether')
  await expect(screen.getByRole('combobox', { name: 'Buy asset' })).toHaveText(
    'ETH · Ether',
  )
  await expect(slippage).toHaveText('1%')
  const amount = screen.getByLabel(`Amount for ${wallet.label}`)
  await expect(amount).toHaveValue('0.1')
  await expect(screen.getByText(/^≈ 0\.1 ETH$/)).toBeVisible()

  const row = screen.getByRole('row').filter({ hasText: wallet.label })
  holdQuote = true
  await screen.getByRole('button', { name: 'Swap 1 wallet' }).click()
  await expect(row).toContainText('Quoting')

  await screen.getByRole('link', { name: 'Settings' }).click()
  await expect(
    screen.getByRole('combobox', { name: 'Origin chain' }),
  ).toHaveCount(0)
  await screen.getByRole('link', { name: 'Swap' }).click()
  await expect(row).toContainText('Quoting')

  released.resolve()
  await expect(row).toContainText('Done')
  await expect(screen.getByText('1 of 1 done')).toBeVisible()
  expect(rpc.count('eth_sendRawTransaction')).toBe(1)
})
