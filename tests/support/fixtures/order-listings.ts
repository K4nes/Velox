import type { JsonValue } from 'e2e'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BYTES32 = `0x${'00'.repeat(32)}`

/** One live listing of one token, by one maker. */
export type OrderListingRow = {
  tokenId: string
  orderHash: string
  priceWei: string
  startTimeSec: number
  expirationTimeSec: number
}

/**
 * One page of `GET /listings/collection/{slug}/all`. Each listing offers one
 * unit and pays the whole price back to the maker, which is what an NFT listing
 * looks like, and carries the fields the collection-scoped endpoint returns.
 */
export function orderListingsFixture(input: {
  chain: string
  maker: string
  contract: string
  protocolAddress: string
  orders: readonly OrderListingRow[]
}): JsonValue {
  return {
    listings: input.orders.map((order) => ({
      order_hash: order.orderHash,
      chain: input.chain,
      protocol_address: input.protocolAddress,
      protocol_data: {
        parameters: {
          offerer: input.maker,
          zone: ZERO_ADDRESS,
          offer: [
            {
              itemType: 1,
              token: input.contract,
              identifierOrCriteria: order.tokenId,
              startAmount: '1',
              endAmount: '1',
            },
          ],
          consideration: [
            {
              itemType: 0,
              token: ZERO_ADDRESS,
              identifierOrCriteria: '0',
              startAmount: order.priceWei,
              endAmount: order.priceWei,
              recipient: input.maker,
            },
          ],
          orderType: 0,
          startTime: String(order.startTimeSec),
          endTime: String(order.expirationTimeSec),
          zoneHash: BYTES32,
          salt: '1',
          conduitKey: BYTES32,
          counter: '0',
          totalOriginalConsiderationItems: 1,
        },
        signature: null,
      },
      asset: { identifier: order.tokenId, contract: input.contract },
      remaining_quantity: 1,
      order_created_at: order.startTimeSec,
      price: {
        current: { currency: 'ETH', decimals: 18, value: order.priceWei },
      },
      price_per_item: {
        currency: 'ETH',
        decimals: 18,
        value: order.priceWei,
      },
      type: 'basic',
      status: 'ACTIVE',
    })),
    next: null,
  }
}
