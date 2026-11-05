export type ChainEntry = {
  slug: string
  chainId: number
  name: string
  currency: { name: string; symbol: string; decimals: number }
  rpcUrl: string
  explorerApi: string
  wrappedNative: string
  wrappedSymbol: string
}

export const chains: ChainEntry[] = [
  {
    slug: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerApi: '',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    wrappedSymbol: 'WETH',
  },
  {
    slug: 'robinhood',
    chainId: 4663,
    name: 'Robinhood Chain',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    // The published host 301-redirects to a parked domain; thirdweb answers 4663.
    rpcUrl: 'https://4663.rpc.thirdweb.com',
    explorerApi: 'https://robinhoodchain.blockscout.com/api/v2',
    wrappedNative: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    wrappedSymbol: 'WETH',
  },
  {
    slug: 'base',
    chainId: 8453,
    name: 'Base',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://mainnet.base.org',
    explorerApi: '',
    wrappedNative: '0x4200000000000000000000000000000000000006',
    wrappedSymbol: 'WETH',
  },
  {
    slug: 'ape_chain',
    chainId: 33139,
    name: 'ApeChain',
    currency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 },
    rpcUrl: 'https://rpc.apechain.com/http',
    explorerApi: '',
    wrappedNative: '0x48b62137EdfA95a428D35C09E44256a739F6B557',
    wrappedSymbol: 'WAPE',
  },
]

export function chainBySlug(slug: string): ChainEntry | undefined {
  return chains.find((chain) => chain.slug === slug)
}
