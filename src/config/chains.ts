export type ChainEntry = {
  slug: string
  chainId: number
  name: string
  currency: { name: string; symbol: string; decimals: number }
  rpcUrl: string
  explorerApi: string
  wrappedNative: string
}

export const chains: ChainEntry[] = [
  {
    slug: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerApi: '',
    wrappedNative: '',
  },
  {
    slug: 'robinhood',
    chainId: 4663,
    name: 'Robinhood Chain',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerApi: 'https://robinhoodchain.blockscout.com/api/v2',
    wrappedNative: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  },
  {
    slug: 'base',
    chainId: 8453,
    name: 'Base',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://mainnet.base.org',
    explorerApi: '',
    wrappedNative: '',
  },
  {
    slug: 'ape_chain',
    chainId: 33139,
    name: 'ApeChain',
    currency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 },
    rpcUrl: 'https://rpc.apechain.com/http',
    explorerApi: '',
    wrappedNative: '',
  },
]

export function chainBySlug(slug: string): ChainEntry | undefined {
  return chains.find((chain) => chain.slug === slug)
}
