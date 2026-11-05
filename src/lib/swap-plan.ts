import { encodeFunctionData, formatUnits, parseAbi, parseUnits } from 'viem'
import type { ChainEntry } from '@/config/chains'

export type SwapDirection = 'wrap' | 'unwrap'
export type SwapAssetKind = 'native' | 'wrapped'

export type NativeAsset = {
  kind: 'native'
  symbol: string
  decimals: number
  address: null
}

export type WrappedAsset = {
  kind: 'wrapped'
  symbol: string
  decimals: number
  address: `0x${string}`
}

export type SwapAsset = NativeAsset | WrappedAsset

export type SwapVenue = {
  chainSlug: string
  assets: { native: NativeAsset; wrapped: WrappedAsset }
}

// null is "not read", never zero: a failed balanceOf must not render as 0.
export type SwapBalances = Record<SwapAssetKind, bigint | null>

export type SwapFees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

export type SwapSnapshot = {
  balances: SwapBalances
  fees: SwapFees | null
  error: string | null
}

export const WRAPPED_NATIVE_ABI = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function balanceOf(address owner) view returns (uint256)',
])

export const SWAP_DIRECTION = {
  wrap: { label: 'Wrap', from: 'native', to: 'wrapped' },
  unwrap: { label: 'Unwrap', from: 'wrapped', to: 'native' },
} as const

// A value-0 deposit() estimate skips the balance-slot write: it measured ~26k
// while a real first wrap cost 45,038 gas on a mainnet fork. Padded 1.25x over
// 70,000 / 55,000 to cover the write.
export const SWAP_GAS_LIMIT = { wrap: 87_500n, unwrap: 68_750n }

export function swapVenue(entry: ChainEntry | undefined): SwapVenue | null {
  if (!entry || !/^0x[0-9a-fA-F]{40}$/.test(entry.wrappedNative)) {
    return null
  }

  return {
    chainSlug: entry.slug,
    assets: {
      native: {
        kind: 'native',
        symbol: entry.currency.symbol,
        decimals: entry.currency.decimals,
        address: null,
      },
      wrapped: {
        kind: 'wrapped',
        symbol: entry.wrappedSymbol,
        decimals: entry.currency.decimals,
        address: entry.wrappedNative as `0x${string}`,
      },
    },
  }
}

export function swapGasCost(fees: SwapFees, direction: SwapDirection): bigint {
  return SWAP_GAS_LIMIT[direction] * fees.maxFeePerGas
}

// Six decimals of headroom on an 18-decimal token. The floor shapes only the
// MAX text; planSwap still validates against the exact balances.
const MAX_PRECISION = 10n ** 12n

export function swapMax(input: {
  direction: SwapDirection
  balances: SwapBalances
  fees: SwapFees | null
}): bigint | null {
  if (input.direction === 'unwrap') {
    return input.balances.wrapped
  }

  const native = input.balances.native
  if (native === null || input.fees === null) {
    return null
  }

  const headroom = native - swapGasCost(input.fees, 'wrap')
  if (headroom <= 0n) {
    return 0n
  }

  return headroom - (headroom % MAX_PRECISION)
}

export type SwapCall = { to: `0x${string}`; data: `0x${string}`; value: bigint }
export type SwapRequest = SwapCall & { gas: SwapFees }

export function swapCall(input: {
  venue: SwapVenue
  direction: SwapDirection
  amount: bigint
}): SwapCall {
  const to = input.venue.assets.wrapped.address

  if (input.direction === 'wrap') {
    return {
      to,
      data: encodeFunctionData({
        abi: WRAPPED_NATIVE_ABI,
        functionName: 'deposit',
      }),
      value: input.amount,
    }
  }

  return {
    to,
    data: encodeFunctionData({
      abi: WRAPPED_NATIVE_ABI,
      functionName: 'withdraw',
      args: [input.amount],
    }),
    value: 0n,
  }
}

export type SwapBlockedReason =
  | 'no-wallet'
  | 'unsupported-chain'
  | 'reading'
  | 'unavailable'
  | 'amount-empty'
  | 'amount-invalid'
  | 'insufficient-balance'
  | 'insufficient-gas'

export type SwapPlan =
  | { status: 'ready'; amount: bigint; request: SwapRequest }
  | { status: 'blocked'; reason: SwapBlockedReason; message: string }

function blocked(reason: SwapBlockedReason, message: string): SwapPlan {
  return { status: 'blocked', reason, message }
}

export function planSwap(input: {
  venue: SwapVenue | null
  direction: SwapDirection
  amountText: string
  wallet: { address: string } | null
  snapshot: SwapSnapshot | null
}): SwapPlan {
  const { venue, direction, amountText, wallet, snapshot } = input

  if (wallet === null) {
    return blocked('no-wallet', 'Select a wallet.')
  }
  if (venue === null) {
    return blocked(
      'unsupported-chain',
      'No wrapped native token is configured for this chain.'
    )
  }
  if (snapshot === null) {
    return blocked('reading', 'Reading the wallet...')
  }

  const op = SWAP_DIRECTION[direction]
  const nativeAsset = venue.assets.native
  const fromAsset = venue.assets[op.from]
  const balances = snapshot.balances
  const fromBalance = balances[op.from]
  const nativeBalance = balances.native
  const fees = snapshot.fees
  // Native is load-bearing in both directions; the wrapped balance only in an
  // unwrap. A failed token balanceOf must never block a wrap.
  if (fees === null || fromBalance === null || nativeBalance === null) {
    return blocked('unavailable', snapshot.error ?? 'Gas price unavailable.')
  }

  if (amountText.trim() === '') {
    return blocked('amount-empty', 'Enter an amount.')
  }

  const amount = parseAmount(amountText, fromAsset.decimals)
  if (amount === null) {
    return blocked('amount-invalid', 'Enter a positive amount.')
  }
  if (amount > fromBalance) {
    return blocked('insufficient-balance', `Not enough ${fromAsset.symbol}.`)
  }

  if (direction === 'wrap') {
    const cost = swapGasCost(fees, 'wrap')
    if (amount + cost > fromBalance) {
      return blocked(
        'insufficient-gas',
        `Leave about ${formatCost(cost, nativeAsset.decimals)} ${nativeAsset.symbol} for gas.`
      )
    }
  } else {
    const cost = swapGasCost(fees, 'unwrap')
    if (nativeBalance < cost) {
      return blocked(
        'insufficient-gas',
        `This wallet needs about ${formatCost(cost, nativeAsset.decimals)} ${nativeAsset.symbol} for gas.`
      )
    }
  }

  return {
    status: 'ready',
    amount,
    request: { ...swapCall({ venue, direction, amount }), gas: fees },
  }
}

function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim()
  if (!/^\d*\.?\d*$/.test(trimmed)) return null
  if ((trimmed.split('.')[1] ?? '').length > decimals) return null

  try {
    const amount = parseUnits(trimmed, decimals)
    return amount > 0n ? amount : null
  } catch {
    return null
  }
}

// Eight decimals keeps a Base-sized reserve readable instead of printing
// "0" at the balances' four decimals.
function formatCost(value: bigint, decimals: number): string {
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.')
  const trimmed = fraction.slice(0, 8).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}
