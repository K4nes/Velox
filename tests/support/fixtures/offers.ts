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
  pinned?: { tokenIds: string; priceWei: bigint | string }
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
            amount: BigInt(pinned.priceWei).toString(),
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

/** One item of a raw Seaport order's offer or consideration array. */
export type CollectionOfferItem = {
  itemType: number
  token: string
  identifierOrCriteria: string
  startAmount: string
  endAmount: string
  recipient?: string
}

/** The wire shape of one collection offer, as an offers page carries it. */
export type CollectionOfferFixture = {
  order_hash: string
  status: string
  chain: string
  protocol_address: string
  remaining_quantity: number
  criteria: { encoded_token_ids: string }
  price_per_item: { currency: string; decimals: number }
  protocol_data: {
    parameters: {
      offerer: string
      zone: string
      offer: CollectionOfferItem[]
      consideration: CollectionOfferItem[]
      orderType: number
      startTime: string
      endTime: string
      zoneHash: string
      salt: string
      conduitKey: string
      counter: string
    }
  }
}

/** One raw `GET /offers/collection/{slug}` offer, with a real Seaport leaf. */
export function collectionOfferFixture(options: {
  contract: string
  protocolAddress: string
  /** Gross price of one unit, in wei. */
  pricePerUnitWei: bigint | string
  /** Units the offer is still willing to buy. */
  remaining: number
  /** Units the order originally offered; a partly filled order keeps this. */
  quantity?: number
  chain?: string
  /** Marketplace fee per unit, in wei. */
  feePerUnitWei?: bigint | string
  offerer?: string
  currency?: { symbol?: string; decimals?: number }
  durationSec?: number
  orderHash?: string
  conduitKey?: string
  /** ItemType 5 is an ERC-1155 criteria item; 4 is ERC-721. */
  itemType?: 4 | 5
}): CollectionOfferFixture {
  const {
    chain = 'robinhood',
    contract,
    protocolAddress,
    pricePerUnitWei,
    remaining,
    quantity = remaining,
    feePerUnitWei = 0n,
    offerer = `0x${'11'.repeat(20)}`,
    currency = {},
    durationSec = 3_600,
    orderHash = `0x${'01'.repeat(32)}`,
    conduitKey = ZERO_HASH,
    itemType = 5,
  } = options

  if (
    !Number.isInteger(remaining) ||
    remaining < 1 ||
    !Number.isInteger(quantity) ||
    quantity < remaining
  ) {
    throw new Error('collectionOfferFixture needs whole order quantities')
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const gross = BigInt(pricePerUnitWei) * BigInt(quantity)
  const fee = BigInt(feePerUnitWei) * BigInt(quantity)

  const consideration: CollectionOfferItem[] = []
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
  // A collection-wide bid names no token: the criteria is zero and the
  // fulfillment's criteria resolver supplies the token being sold.
  consideration.push({
    itemType,
    token: contract,
    identifierOrCriteria: '0',
    startAmount: String(quantity),
    endAmount: String(quantity),
    recipient: offerer,
  })

  return {
    order_hash: orderHash,
    status: 'ACTIVE',
    chain,
    protocol_address: protocolAddress,
    remaining_quantity: remaining,
    criteria: { encoded_token_ids: '*' },
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
            startAmount: gross.toString(),
            endAmount: gross.toString(),
          },
        ],
        consideration,
        orderType: 0,
        startTime: String(nowSec - 60),
        endTime: String(nowSec + durationSec),
        zoneHash: ZERO_HASH,
        salt: '1',
        conduitKey,
        counter: '0',
      },
    },
  }
}

/**
 * The `POST /offers/fulfillment_data` body that fills `units` of an offer made by
 * `collectionOfferFixture`. The fraction is the units over the offer's own
 * quantity, which is what the client re-checks before it signs.
 */
export function offerFulfillmentFixture(options: {
  offer: CollectionOfferFixture
  chainId: number
  fulfiller: string
  tokenId: string
  units: number
}) {
  const parameters = options.offer.protocol_data.parameters
  const nftIndex = parameters.consideration.findIndex(
    (item) => item.itemType === 4 || item.itemType === 5
  )
  const nft = parameters.consideration[nftIndex]
  if (nftIndex < 0 || nft === undefined) {
    throw new Error('offerFulfillmentFixture needs a criteria NFT item')
  }

  const numerator = BigInt(options.units)
  const denominator = BigInt(nft.startAmount)
  if (numerator < 1n || numerator > denominator) {
    throw new Error('offerFulfillmentFixture fills outside the offer quantity')
  }

  return {
    fulfillment_data: {
      transaction: {
        function: 'fulfillAdvancedOrder',
        chain: options.chainId,
        to: options.offer.protocol_address,
        value: '0',
        input_data: {
          advancedOrder: {
            parameters: {
              ...parameters,
              totalOriginalConsiderationItems: parameters.consideration.length,
            },
            numerator: numerator.toString(),
            denominator: denominator.toString(),
            signature: `0x${'11'.repeat(65)}`,
            extraData: '0x',
          },
          criteriaResolvers: [
            {
              orderIndex: 0,
              side: 1,
              index: nftIndex,
              identifier: options.tokenId,
              criteriaProof: [],
            },
          ],
          fulfillerConduitKey: ZERO_HASH,
          recipient: options.fulfiller,
        },
      },
    },
  }
}
