import { expect } from 'e2e'
import type { Screen } from 'e2e'

/** The placeholder every held-token page shows in its filter. */
export const INVENTORY_FILTER_PLACEHOLDER = 'Filter by token, ID or wallet'

/**
 * The filter's accessible name. It lists exactly the three things the filter
 * searches, so a screen-reader user is not told to type a token number and then
 * find that a wallet address matches.
 */
export const INVENTORY_FILTER_LABEL =
  'Filter tokens by name, token ID or wallet address'

/**
 * The bar above the held-token table: a title and the count of the rows on
 * screen, then the filter. Every held-token page shares it, so a page that
 * disagrees on any of the three is the bug this asserts.
 */
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
}

/**
 * Types a term into the filter and asserts the count follows the body: one row
 * left, and the badge reading one. A page whose badge counts the whole scan
 * instead of the visible rows fails here.
 */
export async function filterHeldInventory(
  screen: Screen,
  term: string,
): Promise<void> {
  await screen.getByLabel(INVENTORY_FILTER_LABEL).fill(term)
  await expect(screen.getByRole('row')).toHaveCount(2)
  await expectHeldInventoryHeader(screen, 1)
}
