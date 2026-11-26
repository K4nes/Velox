import { encodeFunctionData } from 'viem'
import type { JsonValue } from 'e2e'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BYTES32 = `0x${'00'.repeat(32)}`

const SET_APPROVAL_FOR_ALL_ABI = [
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
] as const

/**
 * One `POST /listings/actions` body with a single order to sign. The caller
 * echoes the request's own window, price and quantity back, because the plan
 * rejects an order whose terms differ from what the operator asked for.
 *
 * `approval` prepends the token approval step a real response sends when the
 * wallet has not approved the operator yet.
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
  approval?: { operator: string; approved?: boolean; contract?: string }
}): JsonValue {
  const quantity = String(input.quantity)
  const chainId = input.chainId

  return {
    steps: [
      ...(input.approval
        ? [
            {
              itemApprovalAction: {
                assetIdentifier: {
                  contractAddress: input.approval.contract ?? input.contract,
                  tokenId: input.tokenId,
                },
                transaction: {
                  chainIdentifier: { chainId },
                  from: input.offerer,
                  to: input.approval.contract ?? input.contract,
                  data: encodeFunctionData({
                    abi: SET_APPROVAL_FOR_ALL_ABI,
                    functionName: 'setApprovalForAll',
                    args: [
                      input.approval.operator as `0x${string}`,
                      input.approval.approved ?? true,
                    ],
                  }),
                  value: '0',
                },
              },
            },
          ]
        : []),
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
