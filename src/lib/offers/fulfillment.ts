import { encodeFunctionData } from 'viem'
import { offerEconomics } from '@/lib/offers/instant-sell'
import type { CollectionOffer, SellTarget } from '@/lib/offers/instant-sell'
import type { OfferFulfillmentTransaction } from '@/lib/opensea/index'
import { parseOrderComponents } from '@/lib/opensea/seaport'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/
const HEX_BYTES_PATTERN = /^0x([0-9a-fA-F]{2})*$/
const CALLDATA_SUFFIX_PATTERN = /^0x([0-9a-fA-F]{2})+$/

export const FULFILL_ADVANCED_ABI = [
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'address', name: 'offerer', type: 'address' },
              { internalType: 'address', name: 'zone', type: 'address' },
              {
                components: [
                  { internalType: 'enum ItemType', name: 'itemType', type: 'uint8' },
                  { internalType: 'address', name: 'token', type: 'address' },
                  {
                    internalType: 'uint256',
                    name: 'identifierOrCriteria',
                    type: 'uint256',
                  },
                  { internalType: 'uint256', name: 'startAmount', type: 'uint256' },
                  { internalType: 'uint256', name: 'endAmount', type: 'uint256' },
                ],
                internalType: 'struct OfferItem[]',
                name: 'offer',
                type: 'tuple[]',
              },
              {
                components: [
                  { internalType: 'enum ItemType', name: 'itemType', type: 'uint8' },
                  { internalType: 'address', name: 'token', type: 'address' },
                  {
                    internalType: 'uint256',
                    name: 'identifierOrCriteria',
                    type: 'uint256',
                  },
                  { internalType: 'uint256', name: 'startAmount', type: 'uint256' },
                  { internalType: 'uint256', name: 'endAmount', type: 'uint256' },
                  {
                    internalType: 'address payable',
                    name: 'recipient',
                    type: 'address',
                  },
                ],
                internalType: 'struct ConsiderationItem[]',
                name: 'consideration',
                type: 'tuple[]',
              },
              { internalType: 'enum OrderType', name: 'orderType', type: 'uint8' },
              { internalType: 'uint256', name: 'startTime', type: 'uint256' },
              { internalType: 'uint256', name: 'endTime', type: 'uint256' },
              { internalType: 'bytes32', name: 'zoneHash', type: 'bytes32' },
              { internalType: 'uint256', name: 'salt', type: 'uint256' },
              { internalType: 'bytes32', name: 'conduitKey', type: 'bytes32' },
              {
                internalType: 'uint256',
                name: 'totalOriginalConsiderationItems',
                type: 'uint256',
              },
            ],
            internalType: 'struct OrderParameters',
            name: 'parameters',
            type: 'tuple',
          },
          { internalType: 'uint120', name: 'numerator', type: 'uint120' },
          { internalType: 'uint120', name: 'denominator', type: 'uint120' },
          { internalType: 'bytes', name: 'signature', type: 'bytes' },
          { internalType: 'bytes', name: 'extraData', type: 'bytes' },
        ],
        internalType: 'struct AdvancedOrder',
        name: 'advancedOrder',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'uint256', name: 'orderIndex', type: 'uint256' },
          { internalType: 'enum Side', name: 'side', type: 'uint8' },
          { internalType: 'uint256', name: 'index', type: 'uint256' },
          { internalType: 'uint256', name: 'identifier', type: 'uint256' },
          { internalType: 'bytes32[]', name: 'criteriaProof', type: 'bytes32[]' },
        ],
        internalType: 'struct CriteriaResolver[]',
        name: 'criteriaResolvers',
        type: 'tuple[]',
      },
      { internalType: 'bytes32', name: 'fulfillerConduitKey', type: 'bytes32' },
      { internalType: 'address', name: 'recipient', type: 'address' },
    ],
    name: 'fulfillAdvancedOrder',
    outputs: [{ internalType: 'bool', name: 'fulfilled', type: 'bool' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

export type FulfillmentCall = {
  to: `0x${string}`
  data: `0x${string}`
  value: 0n
  fulfillerConduitKey: `0x${string}`
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Unexpected fulfillment data: ${field} is missing`)
  }
  return value as Record<string, unknown>
}

function address(value: unknown, field: string): `0x${string}` {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw new Error(`Unexpected fulfillment data: ${field} is not an address`)
  }
  return value as `0x${string}`
}

function bytes32(value: unknown, field: string): `0x${string}` {
  if (typeof value !== 'string' || !BYTES32_PATTERN.test(value)) {
    throw new Error(`Unexpected fulfillment data: ${field} is not a bytes32 value`)
  }
  return value as `0x${string}`
}

function bytes(value: unknown, field: string): `0x${string}` {
  if (typeof value !== 'string' || !HEX_BYTES_PATTERN.test(value)) {
    throw new Error(`Unexpected fulfillment data: ${field} is not hex data`)
  }
  return value as `0x${string}`
}

function uint(value: unknown, field: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Unexpected fulfillment data: ${field} is not an unsigned integer`
      )
    }
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }
  throw new Error(
    `Unexpected fulfillment data: ${field} is not an unsigned integer`
  )
}

function wireUint(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) {
    return BigInt(value).toString()
  }
  return value
}

function proof(value: unknown, field: string): `0x${string}`[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`Unexpected fulfillment data: ${field} is not an array`)
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !BYTES32_PATTERN.test(entry)) {
      throw new Error(
        `Unexpected fulfillment data: ${field}[${index}] is not a bytes32 value`
      )
    }
    return entry as `0x${string}`
  })
}

export function buildFulfillmentCall(input: {
  transaction: OfferFulfillmentTransaction
  offer: CollectionOffer
  target: SellTarget
  chainId: number
  nowSec: number
}): FulfillmentCall {
  const { transaction, offer, target } = input

  if (transaction.functionName !== 'fulfillAdvancedOrder') {
    throw new Error(`Unsupported fulfillment call: ${transaction.functionName}`)
  }

  if (transaction.chainId !== input.chainId) {
    throw new Error(
      `Fulfillment is for chain ${transaction.chainId}, not ${input.chainId}`
    )
  }

  if (transaction.to.toLowerCase() !== offer.protocolAddress.toLowerCase()) {
    throw new Error(
      `Fulfillment targets ${transaction.to}, not the offer protocol ${offer.protocolAddress}`
    )
  }

  if (uint(transaction.value, 'transaction.value') !== 0n) {
    throw new Error('Offer fulfillment must not send value')
  }

  if (offer.expiresAtSec <= input.nowSec) {
    throw new Error('Offer expired before it could be filled')
  }

  const inputData = record(transaction.inputData, 'input_data')
  const advancedOrder = record(inputData.advancedOrder, 'advancedOrder')
  const criteriaResolvers = inputData.criteriaResolvers
  if (!Array.isArray(criteriaResolvers)) {
    throw new Error(
      'Unexpected fulfillment data: criteriaResolvers is missing'
    )
  }

  const fulfillerConduitKey = bytes32(
    inputData.fulfillerConduitKey,
    'fulfillerConduitKey'
  )
  const recipient = address(inputData.recipient, 'recipient')
  const parameters = record(
    advancedOrder.parameters,
    'advancedOrder.parameters'
  )
  const numerator = uint(advancedOrder.numerator, 'advancedOrder.numerator')
  const denominator = uint(
    advancedOrder.denominator,
    'advancedOrder.denominator'
  )
  const signature = bytes(advancedOrder.signature, 'advancedOrder.signature')
  const extraData = bytes(advancedOrder.extraData, 'advancedOrder.extraData')
  const totalOriginal = uint(
    parameters.totalOriginalConsiderationItems,
    'advancedOrder.parameters.totalOriginalConsiderationItems'
  )

  // OrderParameters has no counter; the signer's leaf does, and the parse needs
  // one to read the rest of the same struct.
  const leaf = parseOrderComponents({
    ...parameters,
    counter: wireUint(parameters.counter ?? '0'),
    startTime: wireUint(parameters.startTime),
    endTime: wireUint(parameters.endTime),
    salt: wireUint(parameters.salt),
  })

  if (leaf.offerer.toLowerCase() !== offer.parameters.offerer.toLowerCase()) {
    throw new Error('Offerer changed since the offer was loaded')
  }
  if (BigInt(leaf.salt) !== BigInt(offer.parameters.salt)) {
    throw new Error('Offer salt changed since the offer was loaded')
  }
  if (BigInt(leaf.endTime) !== BigInt(offer.parameters.endTime)) {
    throw new Error('Offer expiry changed since the offer was loaded')
  }
  if (leaf.conduitKey.toLowerCase() !== offer.parameters.conduitKey.toLowerCase()) {
    throw new Error('Offer conduit changed since the offer was loaded')
  }

  const economics = offerEconomics({
    leaf,
    remaining: offer.remaining,
    currency: offer.currency,
  })
  if (
    !economics ||
    economics.currency.address !== offer.currency.address.toLowerCase() ||
    economics.grossWei !== offer.grossWei ||
    economics.feeWei !== offer.feeWei ||
    economics.netWei !== offer.netWei
  ) {
    throw new Error('Offer terms changed since the offer was loaded')
  }

  const nftIndexes = leaf.consideration.flatMap((item, index) =>
    item.itemType === 4 || item.itemType === 5 ? [index] : []
  )
  if (nftIndexes.length !== 1) {
    throw new Error('Offer does not name exactly one criteria NFT')
  }

  const nftIndex = nftIndexes[0]
  const nft = leaf.consideration[nftIndex]
  if (nft.token.toLowerCase() !== target.contract.toLowerCase()) {
    throw new Error('Offer is for a different collection')
  }
  if (nft.identifierOrCriteria !== '0') {
    throw new Error('Offer is not a collection-wide bid')
  }

  if (criteriaResolvers.length !== 1) {
    throw new Error(
      'Offer fulfillment does not resolve exactly one NFT criteria'
    )
  }
  const resolver = record(criteriaResolvers[0], 'criteriaResolvers[0]')
  const orderIndex = uint(resolver.orderIndex, 'criteriaResolvers[0].orderIndex')
  const side = uint(resolver.side, 'criteriaResolvers[0].side')
  const resolverIndex = uint(resolver.index, 'criteriaResolvers[0].index')
  const identifier = uint(
    resolver.identifier,
    'criteriaResolvers[0].identifier'
  )
  const expectedIdentifier = uint(target.tokenId, 'target.tokenId')

  if (orderIndex !== 0n || side !== 1n || resolverIndex !== BigInt(nftIndex)) {
    throw new Error('Offer fulfillment resolves a different consideration item')
  }
  if (identifier !== expectedIdentifier) {
    throw new Error('Offer fulfillment resolves a different token')
  }

  if (numerator <= 0n || denominator <= 0n) {
    throw new Error('Offer fill fraction must be positive')
  }
  if (BigInt(nft.startAmount) * numerator !== denominator) {
    throw new Error('Offer fulfillment does not fill exactly one unit')
  }

  if (
    recipient.toLowerCase() !== target.address.toLowerCase() &&
    recipient.toLowerCase() !== ZERO_ADDRESS
  ) {
    throw new Error('Offer fulfillment pays a different recipient')
  }

  const suffix = transaction.calldataSuffix
  if (suffix !== null && !CALLDATA_SUFFIX_PATTERN.test(suffix)) {
    throw new Error('Unexpected fulfillment calldata suffix')
  }

  const data = encodeFunctionData({
    abi: FULFILL_ADVANCED_ABI,
    functionName: 'fulfillAdvancedOrder',
    args: [
      {
        parameters: {
          offerer: leaf.offerer as `0x${string}`,
          zone: leaf.zone as `0x${string}`,
          offer: leaf.offer.map((item) => ({
            itemType: item.itemType,
            token: item.token as `0x${string}`,
            identifierOrCriteria: BigInt(item.identifierOrCriteria),
            startAmount: BigInt(item.startAmount),
            endAmount: BigInt(item.endAmount),
          })),
          consideration: leaf.consideration.map((item) => ({
            itemType: item.itemType,
            token: item.token as `0x${string}`,
            identifierOrCriteria: BigInt(item.identifierOrCriteria),
            startAmount: BigInt(item.startAmount),
            endAmount: BigInt(item.endAmount),
            recipient: item.recipient as `0x${string}`,
          })),
          orderType: leaf.orderType,
          startTime: BigInt(leaf.startTime),
          endTime: BigInt(leaf.endTime),
          zoneHash: leaf.zoneHash as `0x${string}`,
          salt: BigInt(leaf.salt),
          conduitKey: leaf.conduitKey as `0x${string}`,
          totalOriginalConsiderationItems: totalOriginal,
        },
        numerator,
        denominator,
        signature,
        extraData,
      },
      [
        {
          orderIndex,
          side: 1,
          index: BigInt(nftIndex),
          identifier,
          criteriaProof: proof(
            resolver.criteriaProof,
            'criteriaResolvers[0].criteriaProof'
          ),
        },
      ],
      fulfillerConduitKey,
      recipient,
    ],
  })

  return {
    to: transaction.to,
    data: (suffix
      ? `${data}${suffix.slice(2)}`
      : data) as `0x${string}`,
    value: 0n,
    fulfillerConduitKey,
  }
}
