import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { mintWallets, walletFolder } from '../support/data'
import { seedVelox } from '../support/seed'

const COLLECTION = 'https://opensea.io/collection/mock-drop'
const COLLECTION_LABEL = 'Collection URL or slug (OpenSea / Scatter)'

// The two items carry their keyboard hint, so the accessible name starts with
// the action and continues into the shortcut.
const COPY = { name: /^Copy/ }
const PASTE = { name: /^Paste/ }

test('a right-click opens the app menu and leaves the page in place', async ({
  app,
  browser,
  screen,
}) => {
  await app.open('/')
  await expect(browser).toHaveURL('/mint/tasks')

  await screen.getByText('Mint Configuration').secondaryTap()

  await expect(screen.getByRole('menu')).toBeVisible()
  await expect(screen.getByRole('menuitem', COPY)).toBeVisible()
  await expect(screen.getByRole('menuitem', PASTE)).toBeVisible()
  await expect(browser).toHaveURL('/mint/tasks')
  await expect(screen.getByText('Mint Configuration')).toBeVisible()
})

test('both items can act when the right-click lands in a filled text field', async ({
  app,
  screen,
}) => {
  await app.open('/')
  const collection = screen.getByLabel(COLLECTION_LABEL)
  await collection.fill(COLLECTION)

  await collection.secondaryTap()

  await expect(screen.getByRole('menuitem', COPY)).toBeEnabled()
  await expect(screen.getByRole('menuitem', PASTE)).toBeEnabled()
})

test('Copy cannot act when there is nothing to copy', async ({ app, screen }) => {
  await app.open('/')

  await screen.getByText('Mint Configuration').secondaryTap()

  await expect(screen.getByRole('menuitem', COPY)).toBeDisabled()
})

test('Paste cannot act when the right-click lands outside a text field', async ({
  app,
  screen,
}) => {
  await app.open('/')

  await screen.getByText('Mint Configuration').secondaryTap()

  await expect(screen.getByRole('menuitem', PASTE)).toBeDisabled()
})

test('Copy then Paste puts the copied text back into the field', async ({
  app,
  screen,
}) => {
  await app.open('/')
  const collection = screen.getByLabel(COLLECTION_LABEL)
  await collection.fill(COLLECTION)

  await collection.secondaryTap()
  await screen.getByRole('menuitem', COPY).click()
  await expect(screen.getByRole('menu')).toBeHidden()

  await collection.fill('')
  await collection.secondaryTap()
  await screen.getByRole('menuitem', PASTE).click()

  await expect(collection).toHaveValue(COLLECTION)
  await expect(collection).toBeFocused()
})

test('Paste says so when the clipboard has no text', async ({
  app,
  browser,
  screen,
}) => {
  await app.open('/')
  await browser.evaluate(async () => {
    await navigator.clipboard.writeText('')
    return true
  })

  const collection = screen.getByLabel(COLLECTION_LABEL)
  await collection.secondaryTap()
  await screen.getByRole('menuitem', PASTE).click()

  await expect(screen.getByText('The clipboard is empty')).toBeVisible()
  await expect(collection).toHaveValue('')
})

test('the menu opens over a popover that renders outside the app subtree', async ({
  app,
  screen,
}) => {
  await app.open('/')
  await screen.getByRole('button', { name: /Select wallets/ }).click()
  const search = screen.getByPlaceholder('Search wallet name or address...')
  await expect(search).toBeVisible()

  await search.secondaryTap()

  await expect(screen.getByRole('menu')).toBeVisible()
  await expect(screen.getByRole('menuitem', PASTE)).toBeEnabled()
})

test('Escape closes the menu', async ({ app, browser, screen }) => {
  await app.open('/')
  await screen.getByText('Mint Configuration').secondaryTap()
  await expect(screen.getByRole('menu')).toBeVisible()

  await browser.keyboard.press('Escape')

  await expect(screen.getByRole('menu')).toBeHidden()
})

test('a paste updates the form the way typing does', async ({
  app,
  browser,
  screen,
}) => {
  const folder = walletFolder('Clipboard')
  const [wallet] = mintWallets(1, folder.id)

  await app.open('/mint/eligibility')
  await seedVelox(browser, { folders: [folder], wallets: [wallet] })
  await app.open('/')

  await screen.getByRole('button', { name: /Select wallets/ }).click()
  await screen
    .getByRole('checkbox', { name: `Select all in ${folder.name}` })
    .check()
  await browser.keyboard.press('Escape')

  // The URL is the only thing the Check button is still waiting for, so it is
  // enabled by the field's state and not by the text the field happens to show.
  const check = screen.getByRole('button', 'Check')
  await expect(check).toBeDisabled()

  await browser.evaluate(async (text) => {
    await navigator.clipboard.writeText(text)
    return true
  }, COLLECTION)

  const collection = screen.getByLabel(COLLECTION_LABEL)
  await collection.secondaryTap()
  await screen.getByRole('menuitem', PASTE).click()

  await expect(collection).toHaveValue(COLLECTION)
  await expect(check).toBeEnabled()
})
