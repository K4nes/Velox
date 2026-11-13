import { expect } from 'e2e'
import type { Screen } from 'e2e'
import type { Browser } from '@e2e-dev/web'

export const INVENTORY_FILTER_PLACEHOLDER = 'Filter by name, ID or wallet'

/**
 * The filter's accessible name lists exactly the three things it searches, so a
 * screen-reader user is never told to type a token number and then find that a
 * wallet address matches.
 */
export const INVENTORY_FILTER_LABEL =
  'Filter tokens by name, token ID or wallet address'

/** A page that disagrees on any of these three is the drift the bar exists to stop. */
export async function expectHeldInventoryHeader(
  screen: Screen,
  count: number,
): Promise<void> {
  const filter = screen.getByLabel(INVENTORY_FILTER_LABEL)
  await expect(filter).toHaveAttribute(
    'placeholder',
    INVENTORY_FILTER_PLACEHOLDER,
  )
  await expect(
    screen.getByText(`${count} ${count === 1 ? 'item' : 'items'}`, {
      exact: true,
    }),
  ).toBeVisible()
  await expect(screen.getByText('Scan complete', { exact: true })).toBeVisible()
}

/** A badge that counts the whole scan instead of the visible rows fails here. */
export async function filterHeldInventory(
  screen: Screen,
  term: string,
): Promise<void> {
  await screen.getByLabel(INVENTORY_FILTER_LABEL).fill(term)
  await expect(screen.getByRole('row')).toHaveCount(2)
  await expectHeldInventoryHeader(screen, 1)
}

/**
 * The page keeps still while the card body scrolls. Without this, a short
 * window scrolls the whole page and the bar leaves the screen, and a green run
 * cannot see it: nothing else asserts geometry.
 */
export async function expectInventoryClamps(browser: Browser): Promise<void> {
  const box = await browser.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent === 'Held NFT Inventory',
    )
    const card = heading?.closest('[data-slot="card"]')
    // The table container is what scrolls: it carries `overflow-x-auto`, which
    // computes `overflow-y` to auto as well, so it takes the vertical overflow
    // inside the bounded body wrapper.
    const body = card?.querySelector<HTMLElement>('[data-slot="table-container"]')
    const page = document.scrollingElement
    return {
      pageScrolls:
        page === null ? true : page.scrollHeight > window.innerHeight + 1,
      bodyScrolls: body
        ? body.scrollHeight > body.clientHeight + 1
        : false,
    }
  })
  expect(box.pageScrolls).toBe(false)
  expect(box.bodyScrolls).toBe(true)
}
