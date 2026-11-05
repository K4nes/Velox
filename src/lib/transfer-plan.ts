import { encodeFunctionData, isAddress, parseUnits } from 'viem'
import { normalize } from 'viem/ens'
import { chainBySlug } from '@/config/chains'
import type { HeldToken } from '@/lib/holdings'
import type { StandardProbe, TokenStandard } from '@/lib/token-standard'

export type ParsedDestination =
  | { kind: 'empty' }
  | { kind: 'address'; address: `0x${string}` }
  | { kind: 'ens'; name: string }
  | { kind: 'invalid'; message: string }

export type Destination = { address: `0x${string}`; ensName: string | null }

export type DestinationResolution =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'checking'; name: string }
  | { status: 'failed'; name: string; message: string }
  | { status: 'ready'; destination: Destination }

export type TransferSelection = {
  key: string
  chain: string
  contract: `0x${string}`
  tokenId: string
  standard: TokenStandard
  decimals: number
  from: { address: string; label: string }
  amount: number
  available: number
}

export type PlannedTransfer = {
  id: string
  tokenKey: string
  chain: string
  contract: `0x${string}`
  tokenId: string
  standard: TokenStandard
  amount: number
  from: string
  to: `0x${string}`
  data: `0x${string}`
}

export type PlannedTransferWallet = {
  address: string
  label: string
  transfers: PlannedTransfer[]
}

export type TransferPlan = {
  chain: string
  destination: Destination
  wallets: PlannedTransferWallet[]
  transferCount: number
  unitCount: number
}

export type TransferPlanErrorCode =
  | 'no-selection'
  | 'duplicate-token'
  | 'chain-mismatch'
  | 'chain-unsupported'
  | 'invalid-token'
  | 'amount-not-positive'
  | 'amount-exceeds-available'
  | 'destination-is-source'

export class TransferPlanError extends Error {
  readonly code: TransferPlanErrorCode

  constructor(code: TransferPlanErrorCode, message: string) {
    super(message)
    this.name = 'TransferPlanError'
    this.code = code
  }
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const TOKEN_ID_PATTERN = /^\d+$/

const ERC721_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'safeTransferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

const ERC1155_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'safeTransferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

export function parseDestination(text: string): ParsedDestination {
  const value = text.trim()
  if (value === '') return { kind: 'empty' }

  // Strict checksum: a lower/upper-case address passes, a mixed-case typo fails
  // instead of sending the token to a different wallet.
  if (isAddress(value)) {
    if (value.toLowerCase() === ZERO_ADDRESS) {
      return {
        kind: 'invalid',
        message: 'The zero address cannot receive NFTs.',
      }
    }
    return { kind: 'address', address: value }
  }

  try {
    const name = normalize(value)
    if (name.toLowerCase().endsWith('.eth')) return { kind: 'ens', name }
  } catch {
    // Not a name the resolver can hash; the shared message below covers it.
  }

  return { kind: 'invalid', message: 'Enter a 0x address or a .eth name.' }
}

export function destinationLabel(
  destination: Destination,
  wallets: readonly { address: string; label: string }[]
): string {
  const address = destination.address.toLowerCase()
  const wallet = wallets.find(
    (entry) => entry.address.toLowerCase() === address
  )
  if (wallet) return wallet.label
  if (destination.ensName) return destination.ensName

  return `${destination.address.slice(0, 6)}…${destination.address.slice(-4)}`
}

export function selectedTransfers(input: {
  tokens: readonly HeldToken[]
  standards: ReadonlyMap<string, StandardProbe>
  sent: ReadonlyMap<string, number>
  selectedKeys: readonly string[]
}): TransferSelection[] {
  const selections: TransferSelection[] = []

  for (const token of input.tokens) {
    if (!input.selectedKeys.includes(token.key)) continue

    const probe = input.standards.get(token.contractAddress.toLowerCase())
    if (probe?.status !== 'known') continue

    const available =
      Math.floor(token.quantity) - (input.sent.get(token.key) ?? 0)
    if (available < 1) continue

    selections.push({
      key: token.key,
      chain: token.chain,
      contract: token.contractAddress as `0x${string}`,
      tokenId: token.tokenId,
      standard: probe.standard,
      decimals: token.decimals,
      from: { address: token.owner.address, label: token.owner.label },
      amount: 1,
      available,
    })
  }

  return selections
}

export function transferCalldata(input: {
  standard: TokenStandard
  from: string
  to: `0x${string}`
  tokenId: string
  amount: number
  decimals: number
}): `0x${string}` {
  if (input.standard === 'erc721') {
    return encodeFunctionData({
      abi: ERC721_TRANSFER_ABI,
      functionName: 'safeTransferFrom',
      args: [input.from as `0x${string}`, input.to, BigInt(input.tokenId)],
    })
  }

  // `amount` is whole display units, so it goes back to raw units exactly once
  // here; the scan already divided by the same `10 ** decimals`.
  return encodeFunctionData({
    abi: ERC1155_TRANSFER_ABI,
    functionName: 'safeTransferFrom',
    args: [
      input.from as `0x${string}`,
      input.to,
      BigInt(input.tokenId),
      parseUnits(String(input.amount), input.decimals),
      '0x',
    ],
  })
}

export function buildTransferPlan(input: {
  chain: string
  destination: Destination
  selections: readonly TransferSelection[]
}): TransferPlan {
  if (input.selections.length === 0) {
    throw new TransferPlanError(
      'no-selection',
      'Select at least one NFT to transfer'
    )
  }

  if (!chainBySlug(input.chain)) {
    throw new TransferPlanError(
      'chain-unsupported',
      `Chain not supported: ${input.chain}`
    )
  }

  const seen = new Set<string>()
  for (const selection of input.selections) {
    if (seen.has(selection.key)) {
      throw new TransferPlanError(
        'duplicate-token',
        `Token #${selection.tokenId} is selected twice`
      )
    }
    seen.add(selection.key)
  }

  const target = input.destination.address.toLowerCase()
  const wallets = new Map<string, PlannedTransferWallet>()

  for (const selection of input.selections) {
    if (selection.chain !== input.chain) {
      throw new TransferPlanError(
        'chain-mismatch',
        `Token #${selection.tokenId} was scanned on ${selection.chain}, expected ${input.chain}`
      )
    }

    if (!ADDRESS_PATTERN.test(selection.contract)) {
      throw new TransferPlanError(
        'invalid-token',
        `Token #${selection.tokenId} has no valid contract address`
      )
    }

    if (!TOKEN_ID_PATTERN.test(selection.tokenId)) {
      throw new TransferPlanError(
        'invalid-token',
        `Token #${selection.tokenId} has no valid token id`
      )
    }

    if (!Number.isInteger(selection.amount) || selection.amount < 1) {
      throw new TransferPlanError(
        'amount-not-positive',
        `Token #${selection.tokenId} needs an amount of at least 1`
      )
    }

    if (selection.amount > selection.available) {
      throw new TransferPlanError(
        'amount-exceeds-available',
        `Token #${selection.tokenId} has only ${selection.available} units available`
      )
    }

    if (selection.from.address.toLowerCase() === target) {
      throw new TransferPlanError(
        'destination-is-source',
        `Token #${selection.tokenId} already sits in the destination wallet`
      )
    }

    const address = selection.from.address.toLowerCase()
    const wallet = wallets.get(address) ?? {
      address,
      label: selection.from.label,
      transfers: [],
    }

    wallet.transfers.push({
      id: `transfer:${selection.key}`,
      tokenKey: selection.key,
      chain: selection.chain,
      contract: selection.contract,
      tokenId: selection.tokenId,
      standard: selection.standard,
      amount: selection.amount,
      from: selection.from.address,
      to: input.destination.address,
      data: transferCalldata({
        standard: selection.standard,
        from: selection.from.address,
        to: input.destination.address,
        tokenId: selection.tokenId,
        amount: selection.amount,
        decimals: selection.decimals,
      }),
    })
    wallets.set(address, wallet)
  }

  const groups = [...wallets.values()]

  return {
    chain: input.chain,
    destination: input.destination,
    wallets: groups,
    transferCount: groups.reduce(
      (sum, wallet) => sum + wallet.transfers.length,
      0
    ),
    unitCount: groups.reduce(
      (sum, wallet) =>
        sum + wallet.transfers.reduce((units, transfer) => units + transfer.amount, 0),
      0
    ),
  }
}

export function explainTransferBlockers(input: {
  selections: readonly TransferSelection[]
  destination: DestinationResolution
  chain: string | null
}): string | null {
  if (input.selections.length === 0) return 'Select NFTs to transfer'

  if (input.destination.status === 'empty') {
    return 'Choose a destination wallet or paste an address'
  }
  if (input.destination.status === 'checking') return 'Resolving destination…'
  if (
    input.destination.status === 'invalid' ||
    input.destination.status === 'failed'
  ) {
    return input.destination.message
  }

  if (input.chain !== null && !chainBySlug(input.chain)) {
    return `Chain not supported: ${input.chain}`
  }

  const target = input.destination.destination.address.toLowerCase()
  if (
    input.selections.some(
      (selection) => selection.from.address.toLowerCase() === target
    )
  ) {
    return 'Destination is a source wallet'
  }

  return null
}
