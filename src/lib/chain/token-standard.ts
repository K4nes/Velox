import {
  AbiDecodingDataSizeInvalidError,
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  isAddress,
} from 'viem'
import { mapLimit } from '@/lib/core/async'
import { toMessage } from '@/lib/core/message'
import { clientFor } from '@/lib/chain/tx'

export type TokenStandard = 'erc721' | 'erc1155'

export type StandardProbe =
  | { status: 'known'; standard: TokenStandard }
  | { status: 'unsupported'; reason: string }
  | { status: 'unreadable'; error: string }

const ERC721_INTERFACE_ID = '0x80ac58cd'
const ERC1155_INTERFACE_ID = '0xd9b67a26'

const ERC165_ABI = [
  {
    type: 'function',
    name: 'supportsInterface',
    stateMutability: 'view',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const OWNER_OF_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
] as const

const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const

const MAX_PROBES = 4

const probes = new Map<string, Promise<StandardProbe>>()

// A selector a contract does not implement either reverts or returns empty
// data. Both mean the function is absent, not that the node failed, so only
// those shapes count as "this contract does not answer".
function isAbsent(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false

  return (
    error.walk(
      (cause) =>
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError ||
        cause instanceof AbiDecodingZeroDataError ||
        cause instanceof AbiDecodingDataSizeTooSmallError ||
        cause instanceof AbiDecodingDataSizeInvalidError
    ) !== null
  )
}

async function probeUncached(input: {
  chain: string
  contract: string
  tokenId: string
  owner: string
}): Promise<StandardProbe> {
  if (!isAddress(input.contract)) {
    return { status: 'unsupported', reason: 'Contract address is not valid' }
  }

  if (!/^\d+$/.test(input.tokenId)) {
    return { status: 'unsupported', reason: 'Token id is not a number' }
  }
  const tokenId = BigInt(input.tokenId)

  const contract = input.contract
  const owner = input.owner

  try {
    const client = await clientFor(input.chain)

    const supportsInterface = async (
      interfaceId: `0x${string}`
    ): Promise<boolean | null> => {
      try {
        return await client.readContract({
          address: contract,
          abi: ERC165_ABI,
          functionName: 'supportsInterface',
          args: [interfaceId],
        })
      } catch (error) {
        if (isAbsent(error)) return null
        throw error
      }
    }

    if (await supportsInterface(ERC721_INTERFACE_ID)) {
      return { status: 'known', standard: 'erc721' }
    }

    if (await supportsInterface(ERC1155_INTERFACE_ID)) {
      return { status: 'known', standard: 'erc1155' }
    }

    // Contracts that predate ERC-165 answer neither call, so the standard's own
    // getter is the last check.
    try {
      await client.readContract({
        address: contract,
        abi: OWNER_OF_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      })
      return { status: 'known', standard: 'erc721' }
    } catch (error) {
      if (!isAbsent(error)) throw error
    }

    if (isAddress(owner)) {
      try {
        await client.readContract({
          address: contract,
          abi: BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [owner, tokenId],
        })
        return { status: 'known', standard: 'erc1155' }
      } catch (error) {
        if (!isAbsent(error)) throw error
      }
    }

    return {
      status: 'unsupported',
      reason: 'Contract answers neither ERC-721 nor ERC-1155',
    }
  } catch (error) {
    return {
      status: 'unreadable',
      error: toMessage(error),
    }
  }
}

export function probeStandard(input: {
  chain: string
  contract: string
  tokenId: string
  owner: string
}): Promise<StandardProbe> {
  const key = `${input.chain}:${input.contract.toLowerCase()}`
  const cached = probes.get(key)
  if (cached) return cached

  const pending = probeUncached(input).then(
    (probe) => {
      if (probe.status === 'unreadable') probes.delete(key)
      return probe
    },
    (error: unknown) => {
      probes.delete(key)
      throw error
    }
  )
  probes.set(key, pending)

  return pending
}

export async function probeStandards(input: {
  chain: string
  tokens: readonly { contract: string; tokenId: string; owner: string }[]
}): Promise<Map<string, StandardProbe>> {
  const byContract = new Map<
    string,
    { contract: string; tokenId: string; owner: string }
  >()

  for (const token of input.tokens) {
    const key = token.contract.toLowerCase()
    if (!byContract.has(key)) byContract.set(key, token)
  }

  const results = await mapLimit(
    [...byContract.entries()],
    MAX_PROBES,
    async ([key, token]) =>
      [
        key,
        await probeStandard({ chain: input.chain, ...token }),
      ] as const
  )

  return new Map(results)
}
