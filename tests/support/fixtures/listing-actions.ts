import type { JsonValue } from 'e2e'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BYTES32 = `0x${'00'.repeat(32)}`

/**
 * One `POST /listings/actions` body with a single order to sign. The caller
 * echoes the request's own window, price and quantity back, because the plan
 * rejects an order whose terms differ from what the operator asked for.
 */
export function listingActionFixture(input: {
  offerer: string
  contract: string
  tokenId: string
  chainId: number
  protocolAddress: string
  startTimeSec: number
  endTimeSec: number
  amountWei: string
  quantity: number
}): JsonValue {
  const quantity = String(input.quantity)
  const chainId = input.chainId

  return {
    steps: [
      {
        createListingsAction: {
          signatureRequest: {
            chainIdentifier: { chainId },
            message: JSON.stringify({
              primaryType: 'OrderComponents',
              domain: {
                name: 'Seaport',
                version: '1.6',
                chainId,
                verifyingContract: input.protocolAddress,
              },
              message: {
                offerer: input.offerer,
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
                    startAmount: input.amountWei,
                    endAmount: input.amountWei,
                    recipient: input.offerer,
                  },
                ],
                orderType: 0,
                startTime: String(input.startTimeSec),
                endTime: String(input.endTimeSec),
                zoneHash: BYTES32,
                salt: '1',
                conduitKey: BYTES32,
                counter: '0',
              },
            }),
          },
          orders: [{ protocolAddress: input.protocolAddress }],
          assetIdentifiers: [
            { contractAddress: input.contract, tokenId: input.tokenId },
          ],
        },
      },
    ],
  }
}
