/**
 * One `GET /collections/{slug}` body, as far as the app reads it: contracts,
 * rarity, fees and the listing currency.
 */
export type CollectionFixtureOptions = {
  slug: string
  name: string
  contract: string
  chain?: string
  imageUrl?: string
  totalSupply?: number
  maxRank?: number
  listingCurrency?: {
    address?: string
    symbol?: string
    decimals?: number
  }
  fees?: { percent: number; required?: boolean }[]
}

const NATIVE_CURRENCY = '0x0000000000000000000000000000000000000000'

export function collectionFixture(options: CollectionFixtureOptions) {
  const {
    slug,
    name,
    contract,
    chain = 'robinhood',
    imageUrl = '',
    totalSupply = 100,
    maxRank = 100,
    listingCurrency = {},
    fees = [],
  } = options

  return {
    collection: slug,
    name,
    image_url: imageUrl,
    total_supply: totalSupply,
    contracts: [{ address: contract, chain }],
    rarity: { max_rank: maxRank },
    fees: fees.map((fee) => ({ fee: fee.percent, required: fee.required ?? true })),
    pricing_currencies: {
      listing_currency: {
        address: listingCurrency.address ?? NATIVE_CURRENCY,
        symbol: listingCurrency.symbol ?? 'ETH',
        decimals: listingCurrency.decimals ?? 18,
      },
    },
  }
}
