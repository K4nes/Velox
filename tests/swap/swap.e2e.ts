import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { customRpc, mintWallets, RH8_FOLDER } from '../support/data'
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

  const [wallet] = mintWallets(1)
  if (!wallet) throw new Error('mintWallets(1) returned no wallet')

  await app.open('/swap')
  await seedVelox(browser, {
    folders: [RH8_FOLDER],
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
  await screen.getByRole('checkbox', { name: 'Select all in Robinhood' }).click()
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
