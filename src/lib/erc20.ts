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

// Relay's approve step is the only approval path, so there is deliberately no
// allowance read or approve writer here.
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
