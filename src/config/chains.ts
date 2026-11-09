export type ChainEntry = {
  slug: string
  chainId: number
  name: string
  currency: { name: string; symbol: string; decimals: number }
  // Receipt polling follows the chain's block time: viem halves it and clamps
  // the result, and without it every receipt polls at the ETH mainnet rate.
  blockTimeMs: number
  rpcUrl: string
  explorerApi: string
  wrappedNative: string
}

export const chains = [
  {
    slug: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTimeMs: 12_000,
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerApi: '',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  {
    slug: 'robinhood',
    chainId: 4663,
    name: 'Robinhood Chain',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTimeMs: 100,
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerApi: 'https://robinhoodchain.blockscout.com/api/v2',
    wrappedNative: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  },
  {
    slug: 'base',
    chainId: 8453,
    name: 'Base',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockTimeMs: 2_000,
    rpcUrl: 'https://mainnet.base.org',
    explorerApi: '',
    wrappedNative: '0x4200000000000000000000000000000000000006',
  },
  {
    slug: 'ape_chain',
    chainId: 33139,
    name: 'ApeChain',
    currency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 },
    blockTimeMs: 250,
    rpcUrl: 'https://rpc.apechain.com/http',
    explorerApi: '',
    wrappedNative: '',
  },
] as const satisfies readonly ChainEntry[]

export type ChainSlug = (typeof chains)[number]['slug']

export function chainBySlug(slug: string): ChainEntry | undefined {
  return chains.find((chain) => chain.slug === slug)
}

// Relay reports numeric ids in step calldata; this is the only way back to a slug.
export function chainByChainId(chainId: number): ChainEntry | undefined {
  return chains.find((chain) => chain.chainId === chainId)
}
