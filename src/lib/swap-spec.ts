import { formatUnits, parseUnits } from 'viem'

import { chainBySlug } from '@/config/chains'
import type { ChainSlug } from '@/config/chains'
import {
  assetByKey,
  assetKey,
  defaultAsset,
} from '@/config/swap-assets'
import type { SwapAssetOption } from '@/config/swap-assets'
import type { SwapBatch } from '@/lib/swap-batch'

export type SwapAmountInput =
  | { readonly kind: 'fixed'; readonly text: string }
  | { readonly kind: 'max' }

export type SwapSpec = {
  readonly from: SwapAssetOption
  readonly to: SwapAssetOption
  readonly amount: SwapAmountInput
  readonly slippageBps: number | null
}

export const SLIPPAGE_OPTIONS: readonly {
  readonly label: string
  readonly bps: number | null
}[] = [
  { label: 'Auto', bps: null },
  { label: '0.1%', bps: 10 },
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
]

// NFT proceeds land as WETH, so Ethereum WETH → ETH is the case the page exists
// for. It is only buildable because `wrappedNative` is filled for Ethereum.
export function defaultSwapSpec(): SwapSpec {
  const entry = chainBySlug('ethereum')
  const from = entry
    ? assetByKey('ethereum', entry.wrappedNative)
    : undefined
  const to = defaultAsset('ethereum')
  if (!from || !to) {
    throw new Error('Ethereum WETH and ETH are not configured')
  }

  return { from, to, amount: { kind: 'fixed', text: '' }, slippageBps: null }
}

export function parseFixedAmount(
  input: SwapAmountInput,
  decimals: number
): bigint | null {
  if (input.kind === 'max') return null

  const value = input.text.trim()
  if (!/^\d*\.?\d*$/.test(value) || !/\d/.test(value)) return null

  try {
    const amount = parseUnits(value, decimals)
    return amount > 0n ? amount : null
  } catch {
    return null
  }
}

// Dust matters here: a balance too small for six decimals would otherwise
// render as 0 and look like an empty wallet.
export function formatSwapAmount(amount: bigint, decimals: number): string {
  const [whole, fraction] = formatUnits(amount, decimals).split('.')
  const trimmed = (fraction ?? '').slice(0, 6).replace(/0+$/, '')
  if (trimmed) return `${whole}.${trimmed}`
  return amount > 0n && whole === '0' ? '<0.000001' : whole
}

// Derived from values, never object identity, so a re-render that rebuilds
// `spec` does not invalidate a resolved batch.
export function specKey(
  spec: SwapSpec,
  walletIds: readonly string[]
): string {
  return [
    `${spec.from.chain}:${assetKey(spec.from.ref)}`,
    `${spec.to.chain}:${assetKey(spec.to.ref)}`,
    spec.amount.kind === 'fixed' ? `fixed:${spec.amount.text}` : 'max',
    spec.slippageBps === null ? 'auto' : String(spec.slippageBps),
    walletIds.join(','),
  ].join('|')
}

export function explainSwapBlockers(input: {
  spec: SwapSpec
  walletCount: number
  pending: boolean
  batch: SwapBatch | null
}): string | null {
  const { spec } = input
  if (input.walletCount === 0) return 'Select at least one wallet'

  if (spec.amount.kind === 'fixed') {
    if (spec.amount.text.trim() === '') return 'Enter an amount'
    if (parseFixedAmount(spec.amount, spec.from.decimals) === null) {
      return `Enter a valid ${spec.from.symbol} amount`
    }
  }

  if (spec.amount.kind === 'max' && spec.from.ref.kind === 'native') {
    return 'Max is not available for a native asset. Enter an amount instead'
  }

  if (
    spec.from.chain === spec.to.chain &&
    assetKey(spec.from.ref) === assetKey(spec.to.ref)
  ) {
    return 'Pick two different assets'
  }

  if (input.pending) return 'Reading balances…'
  if (input.batch === null) return 'Reading balances…'
  if (input.batch.jobs.length === 0) {
    return 'No saved wallets match the selection'
  }

  if (input.batch.shortfall > 0) {
    const count = input.batch.shortfall
    return `${count} ${
      count === 1 ? 'wallet holds' : 'wallets hold'
    } less ${spec.from.symbol} than the amount`
  }

  if (input.batch.unresolved > 0) {
    const count = input.batch.unresolved
    return `${count} ${count === 1 ? 'wallet' : 'wallets'} could not read the ${
      spec.from.symbol
    } balance`
  }

  return null
}

export function routeLabel(spec: SwapSpec): string {
  const fromChain = chainBySlug(spec.from.chain)
  const toChain = chainBySlug(spec.to.chain)
  const fromName = fromChain?.name ?? spec.from.chain
  const toName = toChain?.name ?? spec.to.chain

  return spec.from.chain === spec.to.chain
    ? `${spec.from.symbol} → ${spec.to.symbol} · ${fromName}`
    : `${spec.from.symbol} → ${spec.to.symbol} · ${fromName} → ${toName}`
}

// Changing a chain re-picks that chain's default asset so an address from the
// previous chain cannot survive the change.
export function withOriginChain(spec: SwapSpec, chain: ChainSlug): SwapSpec {
  const from = defaultAsset(chain)
  return from ? { ...spec, from } : spec
}

export function withOriginAsset(spec: SwapSpec, key: string): SwapSpec {
  const from = assetByKey(spec.from.chain, key)
  return from ? { ...spec, from } : spec
}

export function withDestinationChain(
  spec: SwapSpec,
  chain: ChainSlug
): SwapSpec {
  const to = defaultAsset(chain)
  return to ? { ...spec, to } : spec
}

export function withDestinationAsset(spec: SwapSpec, key: string): SwapSpec {
  const to = assetByKey(spec.to.chain, key)
  return to ? { ...spec, to } : spec
}

export function withAmountText(spec: SwapSpec, text: string): SwapSpec {
  return { ...spec, amount: { kind: 'fixed', text } }
}

export function withMaxAmount(spec: SwapSpec): SwapSpec {
  return { ...spec, amount: { kind: 'max' } }
}

export function withSlippage(spec: SwapSpec, bps: number | null): SwapSpec {
  return { ...spec, slippageBps: bps }
}
