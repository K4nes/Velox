import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { walletFolder } from '../support/data'
import {
  checkCollection,
  mockMintNetwork,
  oneWallet,
  pinMintGas,
  seedMintPage,
  waitForEligible,
} from '../support/mint'

const SLUG = 'tx-hash-link'
const EXPLORER = 'https://robinhoodchain.blockscout.com'

test('a confirmed mint keeps its hash as an explorer link', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Tx Hash Link')
  const wallet = oneWallet(folder)
  const network = await mockMintNetwork({
    browser,
    slug: SLUG,
    wallets: [{ address: wallet.address }],
  })

  await seedMintPage(app, browser, folder, [wallet])
  await checkCollection(
    browser,
    screen,
    folder,
    `https://opensea.io/collection/${SLUG}`
  )
  await waitForEligible(screen, 1)
  await pinMintGas(screen)
  await screen.getByRole('button', { name: 'Start Mint' }).click()

  const row = screen.getByRole('row').filter({ hasText: wallet.address })
  await expect(row).toContainText('Confirmed', { timeout: 60_000 })
  const link = row.getByRole('link', { name: /Tx Hash/ })
  await expect(link).toBeVisible()

  const send = network.events.find((event) => event.kind === 'send')
  if (send === undefined) throw new Error('the mint did not send')

  expect({
    href: await link.getAttribute('href'),
    label: await link.getAttribute('aria-label'),
  }).toEqual({
    href: `${EXPLORER}/tx/${send.txHash}`,
    label: `Tx Hash ${send.txHash.slice(0, 10)}, opens in new tab`,
  })
})
