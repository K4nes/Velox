import type { JsonValue } from 'e2e'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BYTES32 = `0x${'00'.repeat(32)}`

/**
 * One page of `GET /orders/{chain}/seaport/listings`: a single live listing by
 * one maker. The offer carries one unit, and the consideration pays the whole
 * price back to the maker, which is what an NFT listing looks like.
 */
export function orderListingsFixture(input: {
  chain: string
  maker: string
  contract: string
  tokenId: string
  orderHash: string
  protocolAddress: string
  priceWei: string
  startTimeSec: number
  expirationTimeSec: number
}): JsonValue {
  const quantity = '1'

  return {
    orders: [
      {
        order_hash: input.orderHash,
        chain: input.chain,
        protocol_address: input.protocolAddress,
        maker: { address: input.maker },
        current_price: input.priceWei,
        expiration_time: input.expirationTimeSec,
        remaining_quantity: Number(quantity),
        cancelled: false,
        finalized: false,
        marked_invalid: false,
        protocol_data: {
          parameters: {
            offerer: input.maker,
            zone: ZERO_ADDRESS,
            offer: [
              {
                itemType: 1,
                token: input.contract,
                identifierOrCriteria: input.tokenId,
                startAmount: quantity,
                endAmount: quantity,
              },
            ],
            consideration: [
              {
                itemType: 0,
                token: ZERO_ADDRESS,
                identifierOrCriteria: '0',
                startAmount: input.priceWei,
                endAmount: input.priceWei,
                recipient: input.maker,
              },
            ],
            orderType: 0,
            startTime: String(input.startTimeSec),
            endTime: String(input.expirationTimeSec),
            zoneHash: BYTES32,
            salt: '1',
            conduitKey: BYTES32,
            counter: '0',
          },
        },
      },
    ],
    next: null,
  }
}
