import { expect } from 'e2e'
import type { Screen } from 'e2e'

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
