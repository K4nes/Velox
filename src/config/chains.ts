export type ChainEntry = {
  slug: string
  chainId: number
  name: string
  currency: { name: string; symbol: string; decimals: number }
  rpcUrl: string
  explorerApi: string
}

export const chains: ChainEntry[] = [
  {
    slug: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerApi: '',
  },
  {
    slug: 'robinhood',
    chainId: 4663,
    name: 'Robinhood Chain',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerApi: 'https://robinhoodchain.blockscout.com/api/v2',
  },
  {
    slug: 'base',
    chainId: 8453,
    name: 'Base',
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://mainnet.base.org',
    explorerApi: '',
  },
  {
    slug: 'ape_chain',
    chainId: 33139,
    name: 'ApeChain',
    currency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 },
    rpcUrl: 'https://rpc.apechain.com/http',
    explorerApi: '',
  },
]

export function chainBySlug(slug: string): ChainEntry | undefined {
  return chains.find((chain) => chain.slug === slug)
}
