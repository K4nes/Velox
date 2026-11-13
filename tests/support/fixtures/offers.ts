/**
 * One `GET /offers/collection/{slug}` page. Each offer is a Seaport bid whose
 * `offer[]` carries the gross amount and whose `consideration[]` carries any
 * fee plus exactly one NFT item, which is what the app's economics require.
 */
export type OfferLadderOptions = {
  chain?: string
  contract: string
  tokenId?: string
  count?: number
  /** Gross per unit, in wei. */
  priceWei?: bigint | string
  /** Marketplace fee per unit, in wei. */
  feeWei?: bigint | string
  currency?: { symbol?: string; decimals?: number }
  offerer?: string
  protocolAddress?: string
  /** How long each bid stays live, in seconds. */
  durationSec?: number
  /** OpenSea's wildcard on an offer that accepts any token in the collection. */
  encodedTokenIds?: string
  pinned?: { tokenIds: string; priceWei?: bigint | string }
}

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`
const ZERO_HASH = `0x${'00'.repeat(32)}`
const FEE_RECIPIENT = `0x${'22'.repeat(20)}`

function orderHash(index: number): string {
  return `0x${(index + 1).toString(16).padStart(64, '0')}`
}

export function offerLadderFixture(options: OfferLadderOptions) {
  const {
    chain = 'robinhood',
    contract,
    tokenId = '1',
    count = 1,
    priceWei = 100_000_000_000_000_000n,
    feeWei = 0n,
    currency = {},
    offerer = `0x${'11'.repeat(20)}`,
    protocolAddress = `0x${'00'.repeat(19)}f2`,
    durationSec = 3_600,
    encodedTokenIds = '*',
    pinned,
  } = options

  const nowSec = Math.floor(Date.now() / 1000)
  const startTime = String(nowSec - 60)
  const endTime = String(nowSec + durationSec)
  const gross = BigInt(priceWei).toString()
  const fee = BigInt(feeWei)

  const consideration: unknown[] = []
  if (fee > 0n) {
    consideration.push({
      itemType: 0,
      token: ZERO_ADDRESS,
      identifierOrCriteria: '0',
      startAmount: fee.toString(),
      endAmount: fee.toString(),
      recipient: FEE_RECIPIENT,
    })
  }
  consideration.push({
    itemType: 2,
    token: contract,
    identifierOrCriteria: tokenId,
    startAmount: '1',
    endAmount: '1',
    recipient: offerer,
  })

  const bids = [
    ...Array.from({ length: count }, () => ({ amount: gross, encodedTokenIds })),
    ...(pinned
      ? [
          {
            amount: BigInt(pinned.priceWei ?? priceWei).toString(),
            encodedTokenIds: pinned.tokenIds,
          },
        ]
      : []),
  ]

  return {
    offers: bids.map((bid, index) => ({
      order_hash: orderHash(index),
      status: 'ACTIVE',
      chain,
      protocol_address: protocolAddress,
      remaining_quantity: 1,
      criteria: { encoded_token_ids: bid.encodedTokenIds },
      price_per_item: {
        currency: currency.symbol ?? 'ETH',
        decimals: currency.decimals ?? 18,
      },
      protocol_data: {
        parameters: {
          offerer,
          zone: ZERO_ADDRESS,
          offer: [
            {
              itemType: 0,
              token: ZERO_ADDRESS,
              identifierOrCriteria: '0',
              startAmount: bid.amount,
              endAmount: bid.amount,
            },
          ],
          consideration,
          orderType: 0,
          startTime,
          endTime,
          zoneHash: ZERO_HASH,
          salt: String(index + 1),
          conduitKey: ZERO_HASH,
          counter: '0',
        },
      },
    })),
    next: null,
  }
}
