import { encodeFunctionData } from 'viem'
import { toMessage } from '@/lib/error-message'
import { clientFor, sendTransaction, waitForReceipt } from '@/lib/tx'
import type { StoredWallet } from '@/lib/wallets'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ('0x' + '00'.repeat(32)) as `0x${string}`
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

const TOKEN_APPROVAL_ABI = [
  {
    type: 'function',
    name: 'isApprovedForAll',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
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

const SEAPORT_CONDUIT_ABI = [
  {
    type: 'function',
    name: 'conduitController',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'controller', type: 'address' }],
  },
] as const

const CONDUIT_CONTROLLER_ABI = [
  {
    type: 'function',
    name: 'getConduit',
    stateMutability: 'view',
    inputs: [{ name: 'conduitKey', type: 'bytes32' }],
    outputs: [
      { name: 'conduit', type: 'address' },
      { name: 'exists', type: 'bool' },
    ],
  },
] as const

export type ApprovalCache = {
  approved: Set<string>
  failed: Map<string, string>
}

export function createApprovalCache(): ApprovalCache {
  return { approved: new Set(), failed: new Map() }
}

const conduitOperators = new Map<string, Promise<`0x${string}`>>()

async function resolveOperator(input: {
  chainSlug: string
  protocolAddress: `0x${string}`
  fulfillerConduitKey: `0x${string}`
}): Promise<`0x${string}`> {
  if (input.fulfillerConduitKey.toLowerCase() === ZERO_BYTES32) {
    return input.protocolAddress
  }

  const key = `${input.chainSlug}:${input.protocolAddress.toLowerCase()}:${input.fulfillerConduitKey.toLowerCase()}`
  const cached = conduitOperators.get(key)
  if (cached) return cached

  const pending = (async () => {
    const client = await clientFor(input.chainSlug)
    const controller = (await client.readContract({
      address: input.protocolAddress,
      abi: SEAPORT_CONDUIT_ABI,
      functionName: 'conduitController',
    })) as `0x${string}`

    if (!ADDRESS_PATTERN.test(controller)) {
      throw new Error('Seaport did not return a conduit controller')
    }

    const [conduit, exists] = (await client.readContract({
      address: controller,
      abi: CONDUIT_CONTROLLER_ABI,
      functionName: 'getConduit',
      args: [input.fulfillerConduitKey],
    })) as readonly [`0x${string}`, boolean]

    if (!exists || conduit.toLowerCase() === ZERO_ADDRESS) {
      throw new Error('The fulfillment conduit is not registered')
    }

    return conduit
  })()

  conduitOperators.set(key, pending)
  // A failed resolution must not poison later attempts.
  pending.catch(() => conduitOperators.delete(key))
  return pending
}

export async function ensureOperatorApproved(input: {
  wallet: StoredWallet
  chainSlug: string
  contract: `0x${string}`
  protocolAddress: `0x${string}`
  fulfillerConduitKey: `0x${string}`
  cache: ApprovalCache
  onApproving?: () => void
  shouldAbort?: () => boolean
}): Promise<void> {
  const owner = input.wallet.address.toLowerCase()
  const contract = input.contract.toLowerCase()

  const operator = await resolveOperator({
    chainSlug: input.chainSlug,
    protocolAddress: input.protocolAddress,
    fulfillerConduitKey: input.fulfillerConduitKey,
  })

  const approvedKey = `${owner}:${contract}:${operator.toLowerCase()}`
  const failure = input.cache.failed.get(approvedKey)
  if (failure) throw new Error(failure)

  try {
    if (input.cache.approved.has(approvedKey)) return

    const client = await clientFor(input.chainSlug)
    const approved = (await client.readContract({
      address: input.contract,
      abi: TOKEN_APPROVAL_ABI,
      functionName: 'isApprovedForAll',
      args: [input.wallet.address as `0x${string}`, operator],
    })) as boolean

    if (approved) {
      input.cache.approved.add(approvedKey)
      return
    }

    input.onApproving?.()
    if (input.shouldAbort?.()) {
      throw new Error('Run stopped before approval')
    }

    const sent = await sendTransaction({
      wallet: input.wallet,
      chainSlug: input.chainSlug,
      to: input.contract,
      data: encodeFunctionData({
        abi: TOKEN_APPROVAL_ABI,
        functionName: 'setApprovalForAll',
        args: [operator, true],
      }),
      value: 0n,
      shouldAbort: input.shouldAbort,
    })

    const receipt = await waitForReceipt(input.chainSlug, sent.txHash)
    if (receipt === 'reverted') {
      throw new Error('Approval transaction reverted')
    }

    input.cache.approved.add(approvedKey)
  } catch (error) {
    const message = toMessage(error)
    input.cache.failed.set(approvedKey, message)
    throw error
  }
}
