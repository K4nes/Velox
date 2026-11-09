import {
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  defineChain,
  fallback,
  http,
  keccak256,
} from 'viem'
import type { Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainBySlug } from '@/config/chains'
import type { ChainEntry } from '@/config/chains'
import { resolveRpcUrls } from '@/lib/connections'
import { traceMint } from '@/lib/mint-trace'
import { toPrivateKeyHex } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export type TxGas = {
  gasLimit?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}

export const WALLET_CONCURRENCY = 2

// The hash is computed before the send, so a transport failure still tells the
// caller which transaction may have reached the node.
export class BroadcastError extends Error {
  readonly txHash: `0x${string}`
  readonly from: `0x${string}`
  readonly nonce: number

  constructor(
    txHash: `0x${string}`,
    cause: Error,
    from: `0x${string}`,
    nonce: number
  ) {
    super(cause.message)
    this.name = 'BroadcastError'
    this.txHash = txHash
    this.from = from
    this.nonce = nonce
  }
}

export function toViemChain(entry: ChainEntry, rpcUrl: string): Chain {
  return defineChain({
    id: entry.chainId,
    name: entry.name,
    nativeCurrency: entry.currency,
    blockTime: entry.blockTimeMs,
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

export async function clientFor(chainSlug: string) {
  const entry = chainBySlug(chainSlug)
  if (!entry) {
    throw new Error(`Unsupported chain: ${chainSlug}`)
  }

  const urls = await resolveRpcUrls(entry.slug)
  return createPublicClient({
    chain: toViemChain(entry, urls[0]),
    // Rank off keeps the operator's priority order: viem's ranker would reorder
    // the URLs by sampled latency and demote the connection they put first.
    // A dead first URL must fail fast, or the next one waits on its retries.
    transport:
      urls.length > 1
        ? fallback(
            urls.map((url) => http(url, { timeout: 8_000, retryCount: 0 })),
            { rank: false }
          )
        : http(urls[0]),
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

// SeaDrop enforces the stage window on-chain. A call that would revert before
// the open succeeds only once the contract accepts the exact mint calldata.
export async function callTransaction(input: {
  chainSlug: string
  from: `0x${string}`
  to: `0x${string}`
  data: `0x${string}`
  value: bigint
}): Promise<void> {
  const client = await clientFor(input.chainSlug)
  await client.call({
    account: input.from,
    to: input.to,
    data: input.data,
    value: input.value,
  })
}

// A pre-open estimate usually reverts because SeaDrop's window is closed. The
// caller keeps it best-effort and leaves the commit-time estimate in place.
export async function estimateGasFor(input: {
  wallet: StoredWallet
  chainSlug: string
  to: `0x${string}`
  data: `0x${string}`
  value: bigint
}): Promise<bigint> {
  const client = await clientFor(input.chainSlug)
  const account = privateKeyToAccount(toPrivateKeyHex(input.wallet.privateKey))
  return client.estimateGas({
    account,
    to: input.to,
    data: input.data,
    value: input.value,
  })
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
}): Promise<{
  txHash: string
  chain: string
  from: `0x${string}`
  nonce: number
}> {
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
}): Promise<{
  txHash: string
  chain: string
  from: `0x${string}`
  nonce: number
}> {
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

  const txHash = keccak256(serializedTransaction)
  let sent = false

  try {
    await client.sendRawTransaction({ serializedTransaction })
    sent = true
  } catch (error) {
    // A 4xx is the proxy rejecting the request before the node sees it; only a
    // network fault, a timeout, or a server-side failure can hide a broadcast.
    const ambiguous =
      error instanceof TimeoutError ||
      (error instanceof HttpRequestError &&
        (error.status === undefined ||
          error.status === 408 ||
          error.status >= 500))
    if (ambiguous) {
      throw new BroadcastError(txHash, error, account.address, nonce)
    }
    throw error
  } finally {
    traceMint({
      kind: 'send-raw',
      walletAddress: account.address,
      txHash,
      ok: sent,
    })
  }

  return { txHash, chain: input.chainSlug, from: account.address, nonce }
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

export type ReceiptOutcome = {
  status: 'success' | 'reverted' | 'replaced' | 'unresolved'
  txHash: string
}

// A receipt for a different hash means the sender's nonce was filled by a
// replacement. A repriced replacement carries the same transfer, so its receipt
// is this transfer's outcome; a cancelled or unrelated one did not move it.
export async function waitForReceiptOutcome(
  chainSlug: string,
  txHash: string,
  replacementHint?: {
    from: `0x${string}`
    nonce: number
    to: `0x${string}`
    input: `0x${string}`
    value: bigint
  }
): Promise<ReceiptOutcome> {
  const replacementRef: {
    current: {
      reason: 'cancelled' | 'replaced' | 'repriced'
      txHash: string
      status: 'success' | 'reverted'
    } | null
  } = { current: null }

  try {
    const client = await clientFor(chainSlug)
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: 90_000,
      ...(replacementHint ? { replacement: replacementHint } : {}),
      onReplaced: (response) => {
        replacementRef.current = {
          reason: response.reason,
          txHash: response.transactionReceipt.transactionHash,
          status: response.transactionReceipt.status,
        }
      },
    })

    if (receipt.transactionHash.toLowerCase() === txHash.toLowerCase()) {
      return { status: receipt.status, txHash: receipt.transactionHash }
    }

    const replacement = replacementRef.current
    if (replacement?.reason === 'repriced') {
      return {
        status: replacement.status,
        txHash: replacement.txHash,
      }
    }

    return { status: 'replaced', txHash: receipt.transactionHash }
  } catch {
    return { status: 'unresolved', txHash }
  }
}
