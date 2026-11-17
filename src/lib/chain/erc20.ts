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
