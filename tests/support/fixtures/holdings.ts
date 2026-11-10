/** One NFT in an account-NFT page. */
export type HoldingRow = {
  contract: string
  identifier: string
  name?: string
  imageUrl?: string
  openseaUrl?: string
  quantity?: number
  decimals?: number
}

/**
 * One `GET /chain/{chain}/account/{address}/nfts` page. `next` must stay
 * `null` or the scan keeps paginating until the page cap.
 */
export function holdingsFixture(
  rows: readonly HoldingRow[],
  options: { next?: string | null } = {},
) {
  return {
    nfts: rows.map((row) => ({
      contract: row.contract,
      identifier: row.identifier,
      name: row.name ?? `Mock #${row.identifier}`,
      display_image_url: row.imageUrl ?? '',
      image_url: row.imageUrl ?? '',
      opensea_url: row.openseaUrl ?? '',
      quantity: row.quantity ?? 1,
      decimals: row.decimals ?? 0,
    })),
    next: options.next ?? null,
  }
}
