export type OfferItem = {
  itemType: number
  token: string
  identifierOrCriteria: string
  startAmount: string
  endAmount: string
}

export type ConsiderationItem = OfferItem & { recipient: string }

export type OrderComponentsLeaf = {
  offerer: string
  zone: string
  offer: OfferItem[]
  consideration: ConsiderationItem[]
  orderType: number
  startTime: string
  endTime: string
  zoneHash: string
  salt: string
  conduitKey: string
  counter: string
}

export type SeaportParameters = OrderComponentsLeaf & {
  totalOriginalConsiderationItems: number
}

export type SignableOrder = Omit<
  OrderComponentsLeaf,
  'offer' | 'consideration' | 'startTime' | 'endTime' | 'salt' | 'counter'
> & {
  offer: {
    itemType: number
    token: string
    identifierOrCriteria: bigint
    startAmount: bigint
    endAmount: bigint
  }[]
  consideration: {
    itemType: number
    token: string
    identifierOrCriteria: bigint
    startAmount: bigint
    endAmount: bigint
    recipient: string
  }[]
  startTime: bigint
  endTime: bigint
  salt: bigint
  counter: bigint
}

export type SeaportDomain = {
  name: string
  version: string
  chainId: number
  verifyingContract: `0x${string}`
}

export type OrderTypedData = {
  types: Record<string, readonly { name: string; type: string }[]>
  primaryType: 'OrderComponents'
  domain: SeaportDomain
  message: SignableOrder
}

export type CancelTypedData = {
  types: Record<string, readonly { name: string; type: string }[]>
  primaryType: 'OrderHash'
  domain: SeaportDomain
  message: { orderHash: `0x${string}` }
}

// Seaport's version is part of the EIP-712 domain, and a cancel is signed against
// the contract that holds the order. The protocol address is the only thing in a
// cancel request that names it, so it is the only source the domain has.
const SEAPORT_VERSIONS: Record<string, string> = {
  '0x0000000000000068f116a894984e2db1123eb395': '1.6',
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': '1.5',
}

export type OrderFees = {
  grossWei: bigint
  feeWei: bigint
  netWei: bigint
  feeRecipients: string[]
}

export type SeaportErrorCode =
  | 'malformed-order'
  | 'unsupported-primary-type'
  | 'invalid-domain'
  | 'no-proceeds-item'
  | 'unknown-protocol'

export class SeaportError extends Error {
  readonly code: SeaportErrorCode

  constructor(code: SeaportErrorCode, message: string) {
    super(message)
    this.name = 'SeaportError'
    this.code = code
  }
}

// The leaf is always signed against Seaport's own OrderComponents ABI, whatever
// container the REST payload wrapped it in. Taking the types from the wire would
// carry the BulkOrder entry along with them.
const ORDER_TYPES: Record<string, readonly { name: string; type: string }[]> = {
  OrderComponents: [
    { name: 'offerer', type: 'address' },
    { name: 'zone', type: 'address' },
    { name: 'offer', type: 'OfferItem[]' },
    { name: 'consideration', type: 'ConsiderationItem[]' },
    { name: 'orderType', type: 'uint8' },
    { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'zoneHash', type: 'bytes32' },
    { name: 'salt', type: 'uint256' },
    { name: 'conduitKey', type: 'bytes32' },
    { name: 'counter', type: 'uint256' },
  ],
  OfferItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
  ],
  ConsiderationItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
}

function malformed(detail: string): SeaportError {
  return new SeaportError('malformed-order', `Malformed Seaport order — ${detail}`)
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw malformed(`${field} is not an object`)
  }
  return value as Record<string, unknown>
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw malformed(`${field} is missing`)
  }
  return value
}

// Every uint arrives as a decimal string and later becomes a bigint; checking
// the shape here keeps the conversion from throwing outside this module's error.
function readUint(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw malformed(`${field} is not an integer string`)
  }
  return value
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw malformed(`${field} is not an integer`)
  }
  return value
}

function readArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw malformed(`${field} is not an array`)
  }
  return value
}

function parseOfferItem(value: unknown, field: string): OfferItem {
  const item = readRecord(value, field)
  return {
    itemType: readInteger(item.itemType, `${field}.itemType`),
    token: readString(item.token, `${field}.token`),
    identifierOrCriteria: readUint(
      item.identifierOrCriteria,
      `${field}.identifierOrCriteria`
    ),
    startAmount: readUint(item.startAmount, `${field}.startAmount`),
    endAmount: readUint(item.endAmount, `${field}.endAmount`),
  }
}

function parseOfferItems(value: unknown, field: string): OfferItem[] {
  return readArray(value, field).map((entry, index) =>
    parseOfferItem(entry, `${field}[${index}]`)
  )
}

export function parseOrderComponents(value: unknown): OrderComponentsLeaf {
  const leaf = readRecord(value, 'message')
  const consideration = readArray(leaf.consideration, 'consideration').map(
    (entry, index) => {
      const field = `consideration[${index}]`
      return {
        ...parseOfferItem(entry, field),
        recipient: readString(readRecord(entry, field).recipient, `${field}.recipient`),
      }
    }
  )

  return {
    offerer: readString(leaf.offerer, 'offerer'),
    zone: readString(leaf.zone, 'zone'),
    offer: parseOfferItems(leaf.offer, 'offer'),
    consideration,
    orderType: readInteger(leaf.orderType, 'orderType'),
    startTime: readUint(leaf.startTime, 'startTime'),
    endTime: readUint(leaf.endTime, 'endTime'),
    zoneHash: readString(leaf.zoneHash, 'zoneHash'),
    salt: readUint(leaf.salt, 'salt'),
    conduitKey: readString(leaf.conduitKey, 'conduitKey'),
    counter: readUint(leaf.counter, 'counter'),
  }
}

// A bulk payload pads its tree to a power of two, and every padding leaf is an
// empty offer. They are not orders and never match a token.
export function leavesOf(input: {
  primaryType: unknown
  message: unknown
}): OrderComponentsLeaf[] {
  if (input.primaryType === 'OrderComponents') {
    return [parseOrderComponents(input.message)]
  }

  if (input.primaryType === 'BulkOrder') {
    const envelope = readRecord(input.message, 'message')
    return readArray(envelope.tree, 'tree')
      .map((leaf, index) => {
        const record = readRecord(leaf, `tree[${index}]`)
        const empty = Array.isArray(record.offer) && record.offer.length === 0
        return empty ? null : parseOrderComponents(record)
      })
      .filter((leaf): leaf is OrderComponentsLeaf => leaf !== null)
  }

  throw new SeaportError(
    'unsupported-primary-type',
    `Unsupported signature request type: ${String(input.primaryType)}`
  )
}

export function parseDomain(value: unknown): SeaportDomain {
  const domain = readRecord(value, 'domain')

  if (typeof domain.chainId !== 'number' || !Number.isInteger(domain.chainId)) {
    throw new SeaportError('invalid-domain', 'Signature domain has no chain id')
  }

  // The signed bytes are unrecoverable if this is wrong, so it is checked as a
  // real address rather than defaulted.
  const verifyingContract = domain.verifyingContract
  if (
    typeof verifyingContract !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(verifyingContract)
  ) {
    throw new SeaportError(
      'invalid-domain',
      'Signature domain has no Seaport contract address'
    )
  }

  // Name and version feed the domain separator, so a default would sign against
  // a domain the payload never named.
  if (typeof domain.name !== 'string' || typeof domain.version !== 'string') {
    throw new SeaportError(
      'invalid-domain',
      'Signature domain has no name or version'
    )
  }

  return {
    name: domain.name,
    version: domain.version,
    chainId: domain.chainId,
    verifyingContract: verifyingContract as `0x${string}`,
  }
}

export function orderToken(leaf: OrderComponentsLeaf): {
  contract: string
  tokenId: string
} {
  const item = leaf.offer[0]
  if (!item) {
    throw malformed('order offers no item')
  }
  return { contract: item.token, tokenId: item.identifierOrCriteria }
}

export function toSeaportParameters(leaf: OrderComponentsLeaf): SeaportParameters {
  return {
    ...leaf,
    totalOriginalConsiderationItems: leaf.consideration.length,
  }
}

export function typedDataForLeaf(
  leaf: OrderComponentsLeaf,
  domain: SeaportDomain
): OrderTypedData {
  return {
    types: ORDER_TYPES,
    primaryType: 'OrderComponents',
    domain,
    message: {
      offerer: leaf.offerer,
      zone: leaf.zone,
      offer: leaf.offer.map((item) => ({
        itemType: item.itemType,
        token: item.token,
        identifierOrCriteria: BigInt(item.identifierOrCriteria),
        startAmount: BigInt(item.startAmount),
        endAmount: BigInt(item.endAmount),
      })),
      consideration: leaf.consideration.map((item) => ({
        itemType: item.itemType,
        token: item.token,
        identifierOrCriteria: BigInt(item.identifierOrCriteria),
        startAmount: BigInt(item.startAmount),
        endAmount: BigInt(item.endAmount),
        recipient: item.recipient,
      })),
      orderType: leaf.orderType,
      startTime: BigInt(leaf.startTime),
      endTime: BigInt(leaf.endTime),
      zoneHash: leaf.zoneHash,
      salt: BigInt(leaf.salt),
      conduitKey: leaf.conduitKey,
      counter: BigInt(leaf.counter),
    },
  }
}

// The off-chain cancel is authorised by the offerer signing the order hash itself
// against the Seaport domain the order was listed on, so the signature is the
// order's own identifier and never a copy of the order terms.
export function cancelTypedData(input: {
  chainId: number
  protocolAddress: string
  orderHash: string
}): CancelTypedData {
  const version = SEAPORT_VERSIONS[input.protocolAddress.toLowerCase()]
  if (version === undefined) {
    throw new SeaportError(
      'unknown-protocol',
      `Unsupported Seaport contract ${input.protocolAddress}`
    )
  }

  return {
    types: { OrderHash: [{ name: 'orderHash', type: 'bytes32' }] },
    primaryType: 'OrderHash',
    domain: {
      name: 'Seaport',
      version,
      chainId: input.chainId,
      verifyingContract: input.protocolAddress as `0x${string}`,
    },
    message: { orderHash: input.orderHash as `0x${string}` },
  }
}

export function splitConsideration(leaf: OrderComponentsLeaf): OrderFees {  const offerer = leaf.offerer.toLowerCase()
  let grossWei = 0n
  let feeWei = 0n
  let paysOfferer = false
  const recipients = new Map<string, string>()

  for (const item of leaf.consideration) {
    const amount = BigInt(item.startAmount)
    grossWei += amount

    const recipient = item.recipient.toLowerCase()
    if (recipient === offerer) {
      paysOfferer = true
      continue
    }

    feeWei += amount
    if (!recipients.has(recipient)) recipients.set(recipient, item.recipient)
  }

  if (!paysOfferer) {
    throw new SeaportError(
      'no-proceeds-item',
      'Order has no consideration item paying the seller'
    )
  }

  return {
    grossWei,
    feeWei,
    netWei: grossWei - feeWei,
    feeRecipients: [...recipients.values()],
  }
}
