import { mapLimit } from '@/lib/core/async'
import { scanFailureMessage } from '@/lib/opensea/failure-message'
import { getAccountNfts } from '@/lib/opensea/index'

export type ScanWallet = { id: string; label: string; address: string }
export type CollapsedWallet = { address: string; labels: string[] }
export type WalletScan = {
  wallet: ScanWallet
  tokens: number
  error: string | null
  // True when the page cap, a repeated cursor or an abort stopped this wallet
  // before its listing ended.
  truncated: boolean
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
  // The API is free to spell a chain or a contract in either case, and one
  // token arriving twice in two spellings is still one token. The ID stays
  // exact, because it is the one field where case can carry meaning.
  return `${address.toLowerCase()}:${chain.toLowerCase()}:${contract.toLowerCase()}:${tokenId}`
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

// A wallet usually lists a handful of tokens per collection. The cap bounds a
// pathological account instead of pacing a normal one, matching the listing and
// offer readers.
const HOLDINGS_PAGE_CAP = 5

export async function scanHeldTokens(input: {
  chain: string
  slug: string
  wallets: readonly ScanWallet[]
  onToken?: (token: HeldToken) => void
  onWallet?: (scan: WalletScan) => void
  signal?: AbortSignal
}): Promise<{ tokens: HeldToken[]; scans: WalletScan[]; truncated: boolean }> {
  const tokens = new Map<string, HeldToken>()
  const scans = new Map<string, WalletScan>()
  let truncated = false

  async function scanWallet(wallet: ScanWallet): Promise<WalletScan> {
    let cursor: string | undefined
    let found = 0
    let walletTruncated = false

    try {
      const seen = new Set<string>()
      let pages = 0

      while (true) {
        if (input.signal?.aborted) {
          walletTruncated = true
          break
        }

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

        pages += 1
        const next = page.next ?? undefined
        if (next === undefined) break

        // The same cursor twice would fetch the same page forever; the page cap
        // catches a chain of ever-new cursors instead.
        if (next === cursor || seen.has(next) || pages >= HOLDINGS_PAGE_CAP) {
          walletTruncated = true
          break
        }

        seen.add(next)
        cursor = next
      }
    } catch (failure) {
      return {
        wallet,
        tokens: found,
        error: scanFailureMessage(failure, 'wallet'),
        truncated: walletTruncated,
      }
    }

    return { wallet, tokens: found, error: null, truncated: walletTruncated }
  }

  await mapLimit(input.wallets, 3, async (wallet) => {
    const result = await scanWallet(wallet)
    if (result.truncated) truncated = true
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
    truncated,
  }
}
