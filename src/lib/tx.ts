import { createPublicClient, defineChain, http } from 'viem'
import type { Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainBySlug } from '@/config/chains'
import type { ChainEntry } from '@/config/chains'
import { resolveRpcUrl } from '@/lib/secrets'
import { toPrivateKeyHex } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export type TxGas = {
  gasLimit?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}

export function toViemChain(entry: ChainEntry, rpcUrl: string): Chain {
  return defineChain({
    id: entry.chainId,
    name: entry.name,
    nativeCurrency: entry.currency,
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

export async function clientFor(chainSlug: string) {
  const entry = chainBySlug(chainSlug)
  if (!entry) {
    throw new Error(`Unsupported chain: ${chainSlug}`)
  }

  const rpcUrl = await resolveRpcUrl(entry.slug)
  return createPublicClient({
    chain: toViemChain(entry, rpcUrl),
    transport: http(rpcUrl),
  })
}

// A stage opens on the chain's clock, not the operator's. Reading the latest
// block keeps the countdown honest when the desktop clock is minutes off, which
// is exactly the window a scheduled mint has to fire in.
export async function chainTime(chainSlug: string): Promise<number> {
  const client = await clientFor(chainSlug)
  const block = await client.getBlock({ blockTag: 'latest' })
  return Number(block.timestamp) * 1000
}

// Two tasks can select the same wallet. The nonce is read from `pending` and the
// transaction is signed right after, so the read and the send must be serialized
// per address or both tasks sign the same nonce and the second replaces the
// first in the pool, leaving a row marked broadcast for a hash that never mines.
const inflight = new Map<string, Promise<unknown>>()

export async function sendTransaction(input: {
  wallet: StoredWallet
  chainSlug: string
  to: `0x${string}`
  data: `0x${string}`
  value: bigint
  gas?: TxGas
  shouldAbort?: () => boolean
}): Promise<{ txHash: string; chain: string }> {
  const key = input.wallet.address.toLowerCase()
  const previous = inflight.get(key) ?? Promise.resolve()
  const next = previous.then(
    () => broadcast(input),
    () => broadcast(input)
  )
  inflight.set(key, next)

  try {
    return await next
  } finally {
    if (inflight.get(key) === next) inflight.delete(key)
  }
}

async function broadcast(input: {
  wallet: StoredWallet
  chainSlug: string
  to: `0x${string}`
  data: `0x${string}`
  value: bigint
  gas?: TxGas
  shouldAbort?: () => boolean
}): Promise<{ txHash: string; chain: string }> {
  const entry = chainBySlug(input.chainSlug)
  if (!entry) {
    throw new Error(`Unsupported chain: ${input.chainSlug}`)
  }

  const client = await clientFor(entry.slug)
  const account = privateKeyToAccount(toPrivateKeyHex(input.wallet.privateKey))
  const gas = input.gas ?? {}

  let maxFeePerGas = gas.maxFeePerGas
  let maxPriorityFeePerGas = gas.maxPriorityFeePerGas

  if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) {
    const estimated = await client.estimateFeesPerGas()
    maxFeePerGas ??= estimated.maxFeePerGas
    maxPriorityFeePerGas ??= estimated.maxPriorityFeePerGas
  }

  // A tip above the cap is not signable: viem throws TipAboveFeeCapError, so a
  // user who raises only the tip would fail every wallet instead of sending.
  if (maxPriorityFeePerGas > maxFeePerGas) {
    maxFeePerGas = maxPriorityFeePerGas
  }

  const gasLimit =
    gas.gasLimit ??
    (await client.estimateGas({
      account,
      to: input.to,
      data: input.data,
      value: input.value,
    }))
  const nonce = await client.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  })

  const serializedTransaction = await account.signTransaction({
    type: 'eip1559',
    chainId: entry.chainId,
    to: input.to,
    data: input.data,
    value: input.value,
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce,
  })

  if (input.shouldAbort?.()) {
    throw new Error('Transaction stopped before broadcast')
  }

  const txHash = await client.sendRawTransaction({ serializedTransaction })

  return { txHash, chain: input.chainSlug }
}

export async function waitForReceipt(
  chainSlug: string,
  txHash: string
): Promise<'success' | 'reverted'> {
  const client = await clientFor(chainSlug)
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    timeout: 90_000,
  })

  return receipt.status
}
