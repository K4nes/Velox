import type { PublicClient } from 'viem'

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

// Relay's approve step is the only approval path, so there is deliberately no approve
// writer here. Check reads the allowance so it can tell a wallet that needs approval
// apart from one that is blocked.
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
