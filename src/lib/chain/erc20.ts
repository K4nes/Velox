import { encodeFunctionData } from 'viem'
import type { PublicClient } from 'viem'
import { sendTransaction } from '@/lib/chain/tx'
import type { TxGas } from '@/lib/chain/tx'
import type { StoredWallet } from '@/lib/wallet/wallets'

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const ERC20_ALLOWANCE_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const ERC20_METADATA_ABI = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// Relay's approve step is the only approval path for a swap. A Scatter mint grants its
// own allowance, so the writer lives here beside the reads; Check also reads the token
// metadata and the allowance so it can tell a wallet that needs approval apart from one
// that is blocked.
export async function readTokenBalance(input: {
  client: PublicClient
  token: `0x${string}`
  owner: `0x${string}`
}): Promise<bigint> {
  return input.client.readContract({
    address: input.token,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [input.owner],
  })
}

export async function readTokenAllowance(input: {
  client: PublicClient
  token: `0x${string}`
  owner: `0x${string}`
  spender: `0x${string}`
}): Promise<bigint> {
  return input.client.readContract({
    address: input.token,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: 'allowance',
    args: [input.owner, input.spender],
  })
}

// A token that states its own symbol and decimals is displayable even when the build
// or the stage carries no payment metadata. Both reads must succeed and agree: a
// partial answer would price the token in the wrong scale, so it is discarded
// instead. Metadata is display-only and must never fail the mint verdict.
export async function readTokenMetadata(input: {
  client: PublicClient
  token: `0x${string}`
}): Promise<{ symbol?: string; decimals?: number }> {
  try {
    const [symbol, decimals] = await Promise.all([
      input.client.readContract({
        address: input.token,
        abi: ERC20_METADATA_ABI,
        functionName: 'symbol',
      }),
      input.client.readContract({
        address: input.token,
        abi: ERC20_METADATA_ABI,
        functionName: 'decimals',
      }),
    ])
    if (
      typeof symbol !== 'string' ||
      symbol.length === 0 ||
      !Number.isInteger(decimals) ||
      decimals < 0
    ) {
      return {}
    }
    return { symbol, decimals }
  } catch {
    return {}
  }
}

// A Scatter list priced in an ERC-20 pulls the token when its mint runs, so the minter
// first grants that exact amount to the collection. The send goes through the mint's own
// signing path, so a stop signal and the fee settings apply to both transactions.
export async function approveToken(input: {
  wallet: StoredWallet
  chainSlug: string
  token: `0x${string}`
  spender: `0x${string}`
  amount: bigint
  gas?: TxGas
  shouldAbort?: () => boolean
}): Promise<{ txHash: string; chain: string }> {
  return sendTransaction({
    wallet: input.wallet,
    chainSlug: input.chainSlug,
    to: input.token,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [input.spender, input.amount],
    }),
    value: 0n,
    gas: input.gas,
    shouldAbort: input.shouldAbort,
  })
}
