import { getAccountNfts, OpenSeaError } from '@/lib/opensea'
import { mapLimit } from '@/lib/async'

export type ScanWallet = { id: string; label: string; address: string }
export type CollapsedWallet = { address: string; labels: string[] }
export type WalletScan = {
  wallet: ScanWallet
  tokens: number
  error: string | null
}

export type HeldToken = {
  key: string
  chain: string
  contractAddress: string
  tokenId: string
  name: string
  imageUrl: string
  openseaUrl: string
  quantity: number
  decimals: number
  owner: ScanWallet
}

export function holdingKey(
  address: string,
  chain: string,
  contract: string,
  tokenId: string
): string {
  return `${address.toLowerCase()}:${chain}:${contract}:${tokenId}`
}

export function resolveScanWallets(
  records: readonly { id: string; label: string; address: string }[]
): { wallets: ScanWallet[]; collapsed: CollapsedWallet[] } {
  const wallets = new Map<string, ScanWallet>()
  const dropped = new Map<string, string[]>()

  for (const record of records) {
    const address = record.address.toLowerCase()

    if (!wallets.has(address)) {
      wallets.set(address, { id: record.id, label: record.label, address })
      continue
    }

    const labels = dropped.get(address) ?? []
    labels.push(record.label)
    dropped.set(address, labels)
  }

  return {
    wallets: [...wallets.values()],
    collapsed: [...dropped].map(([address, labels]) => ({ address, labels })),
  }
}

export function scanFailureMessage(
  error: unknown,
  step: 'collection' | 'wallet' | 'rarity'
): string {
  if (error instanceof OpenSeaError) {
    if (error.status === 0) return error.message
    if (error.status === 401) return 'OpenSea API key rejected'
    if (error.status === 404 && step === 'collection') {
      return 'Collection not found'
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return step === 'collection' ? `Collection failed — ${message}` : message
}

export async function scanHeldTokens(input: {
  chain: string
  slug: string
  wallets: readonly ScanWallet[]
  onToken?: (token: HeldToken) => void
  onWallet?: (scan: WalletScan) => void
}): Promise<{ tokens: HeldToken[]; scans: WalletScan[] }> {
  const tokens = new Map<string, HeldToken>()
  const scans = new Map<string, WalletScan>()

  async function scanWallet(wallet: ScanWallet): Promise<WalletScan> {
    let cursor: string | undefined
    let found = 0

    try {
      do {
        const page = await getAccountNfts({
          chain: input.chain,
          address: wallet.address,
          slug: input.slug,
          cursor,
        })

        for (const nft of page.nfts) {
          const key = holdingKey(
            wallet.address,
            nft.chain,
            nft.contractAddress,
            nft.tokenId
          )
          if (tokens.has(key)) continue

          found += 1
          const token: HeldToken = {
            key,
            chain: nft.chain,
            contractAddress: nft.contractAddress,
            tokenId: nft.tokenId,
            name: nft.name,
            imageUrl: nft.imageUrl,
            openseaUrl: nft.openseaUrl,
            quantity: nft.quantity,
            decimals: nft.decimals,
            owner: wallet,
          }
          tokens.set(key, token)
          input.onToken?.(token)
        }

        cursor = page.next ?? undefined
      } while (cursor)
    } catch (failure) {
      return { wallet, tokens: found, error: scanFailureMessage(failure, 'wallet') }
    }

    return { wallet, tokens: found, error: null }
  }

  await mapLimit(input.wallets, 3, async (wallet) => {
    const result = await scanWallet(wallet)
    scans.set(wallet.address, result)
    input.onWallet?.(result)
    return result
  })

  return {
    tokens: [...tokens.values()],
    scans: input.wallets.flatMap((wallet) => {
      const scan = scans.get(wallet.address)
      return scan ? [scan] : []
    }),
  }
}
