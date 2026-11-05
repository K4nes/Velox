import { chains } from '@/config/chains'
import type { ChainSlug } from '@/config/chains'

export type SwapAssetRef =
  | { readonly kind: 'native' }
  | { readonly kind: 'token'; readonly address: `0x${string}` }

export type SwapAssetOption = {
  readonly chain: ChainSlug
  readonly ref: SwapAssetRef
  readonly symbol: string
  readonly name: string
  readonly decimals: number
}

// Relay routes native currency through the zero address. Nowhere else names it.
const NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000' as const

// Curated from the verified addresses in docs/relay-swap-research.md §5. X Layer
// (196) is intentionally absent: this app has no chain entry, RPC, or explorer
// for it, so a USDG option there could never be quoted or signed.
const CURATED: readonly SwapAssetOption[] = [
  {
    chain: 'robinhood',
    ref: {
      kind: 'token',
      address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    },
    symbol: 'USDG',
    name: 'Global Dollar',
    decimals: 6,
  },
  {
    chain: 'ethereum',
    ref: {
      kind: 'token',
      address: '0xe343167631d89B6Ffc58B88d6b7fB0228795491D',
    },
    symbol: 'USDG',
    name: 'Global Dollar',
    decimals: 6,
  },
]

export function assetKey(ref: SwapAssetRef): string {
  return ref.kind === 'native' ? 'native' : ref.address.toLowerCase()
}

export function assetOptions(chain: ChainSlug): readonly SwapAssetOption[] {
  const entry = chains.find((candidate) => candidate.slug === chain)
  if (!entry) return []

  const options: SwapAssetOption[] = [
    {
      chain,
      ref: { kind: 'native' },
      symbol: entry.currency.symbol,
      name: entry.currency.name,
      decimals: entry.currency.decimals,
    },
  ]

  if (entry.wrappedNative !== '') {
    options.push({
      chain,
      ref: {
        kind: 'token',
        address: entry.wrappedNative as `0x${string}`,
      },
      symbol: `W${entry.currency.symbol}`,
      name: `Wrapped ${entry.currency.name}`,
      decimals: entry.currency.decimals,
    })
  }

  options.push(...CURATED.filter((option) => option.chain === chain))

  return options
}

export function defaultAsset(chain: ChainSlug): SwapAssetOption | undefined {
  return assetOptions(chain)[0]
}

export function assetByKey(
  chain: ChainSlug,
  key: string
): SwapAssetOption | undefined {
  const normalized = key.toLowerCase()
  return assetOptions(chain).find(
    (option) => assetKey(option.ref) === normalized
  )
}

export function relayCurrency(ref: SwapAssetRef): `0x${string}` {
  return ref.kind === 'native' ? NATIVE_SENTINEL : ref.address
}
