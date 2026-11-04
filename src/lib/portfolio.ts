import {
  NFT_BATCH_MAX,
  getCollection,
  getCollectionStats,
  getNftRankBatch,
} from '@/lib/opensea'
import type { CollectionInfo, CollectionStats } from '@/lib/opensea'
import { mapLimit } from '@/lib/async'
import { scanFailureMessage, scanHeldTokens } from '@/lib/holdings'
import type { CollapsedWallet, ScanWallet, WalletScan } from '@/lib/holdings'
import { fetchEthUsdtPrice } from '@/lib/price'

export type RarityState =
  | { status: 'pending' }
  | { status: 'ranked'; rank: number }
  | { status: 'unranked' }
  | { status: 'missing' }
  | { status: 'failed'; message: string }
export type HoldingBase = {
  id: string
  chain: string
  contractAddress: string
  tokenId: string
  name: string
  imageUrl: string
  openseaUrl: string
  quantity: number
  owner: ScanWallet
  rarity: RarityState
}
export type ScanningHolding = HoldingBase
export type PortfolioHolding = HoldingBase & {
  rarity: Exclude<RarityState, { status: 'pending' }>
}
export type ScanSnapshot = {
  collection: CollectionInfo
  stats: CollectionStats | null
  ethUsd: number | null
  wallets: WalletScan[]
  collapsed: CollapsedWallet[]
  holdings: ScanningHolding[]
}
export type PortfolioScanResult = Omit<ScanSnapshot, 'holdings'> & {
  holdings: PortfolioHolding[]
}
export type PortfolioScanState =
  | { status: 'idle' }
  | { status: 'scanning'; snapshot: ScanSnapshot }
  | { status: 'ready'; result: PortfolioScanResult }
  | { status: 'failed'; message: string }
export type PortfolioTableState =
  | { status: 'idle'; message: string }
  | { status: 'loading'; message: string }
  | { status: 'error'; message: string }
  | { status: 'empty'; message: string }
  | { status: 'ready' }
export type RarityTier = 'legendary' | 'epic' | 'rare' | 'common'
export type RarityTierFilter = 'all' | RarityTier
export type HoldingSort = 'rarest' | 'commonest'

export function percentileOf(
  rank: number,
  maxRank: number | null
): number | null {
  if (maxRank === null || maxRank <= 0) return null
  return (rank / maxRank) * 100
}

export function rarityTierOf(
  rank: number,
  maxRank: number | null
): RarityTier | null {
  const percentile = percentileOf(rank, maxRank)
  if (percentile === null) return null
  if (percentile <= 1) return 'legendary'
  if (percentile <= 10) return 'epic'
  if (percentile <= 33) return 'rare'
  return 'common'
}

export function rarityFilterOf(
  row: ScanningHolding,
  maxRank: number | null
): RarityTier | null {
  if (row.rarity.status !== 'ranked') return null
  return rarityTierOf(row.rarity.rank, maxRank)
}

export function countRarityTiers(
  rows: readonly ScanningHolding[],
  maxRank: number | null
): Record<RarityTierFilter, number> {
  const counts: Record<RarityTierFilter, number> = {
    all: rows.length,
    legendary: 0,
    epic: 0,
    rare: 0,
    common: 0,
  }

  for (const row of rows) {
    const tier = rarityFilterOf(row, maxRank)
    if (tier !== null) counts[tier] += 1
  }

  return counts
}

export function searchHoldings(
  rows: readonly ScanningHolding[],
  query: string
): ScanningHolding[] {
  const term = query.trim().toLowerCase()
  if (!term) return [...rows]

  return rows.filter((row) =>
    [
      row.name,
      `#${row.tokenId}`,
      row.tokenId,
      row.owner.label,
      row.owner.address,
    ].some((value) => value.toLowerCase().includes(term))
  )
}

function numericTokenId(tokenId: string): bigint | null {
  return /^\d+$/.test(tokenId) ? BigInt(tokenId) : null
}

function compareTokenFallback(a: ScanningHolding, b: ScanningHolding): number {
  const left = numericTokenId(a.tokenId)
  const right = numericTokenId(b.tokenId)
  if (left !== null && right !== null && left !== right) {
    return left < right ? -1 : 1
  }

  const byToken = a.tokenId.localeCompare(b.tokenId)
  if (byToken !== 0) return byToken
  return a.owner.address.localeCompare(b.owner.address)
}

export function sortHoldings(
  rows: readonly ScanningHolding[],
  sort: HoldingSort
): ScanningHolding[] {
  return [...rows].sort((a, b) => {
    if (a.rarity.status === 'ranked' && b.rarity.status === 'ranked') {
      if (a.rarity.rank !== b.rarity.rank) {
        return sort === 'rarest'
          ? a.rarity.rank - b.rarity.rank
          : b.rarity.rank - a.rarity.rank
      }
      return compareTokenFallback(a, b)
    }

    if (a.rarity.status === 'ranked') return -1
    if (b.rarity.status === 'ranked') return 1
    return compareTokenFallback(a, b)
  })
}

export function portfolioStats(input: {
  holdings: readonly ScanningHolding[]
  wallets: readonly WalletScan[]
  maxRank: number | null
}): {
  rows: number
  units: number
  walletsHolding: number
  bestRank: number | null
  bestTier: RarityTier | null
  ranked: number
  pending: number
  unranked: number
  unavailable: number
} {
  let units = 0
  let ranked = 0
  let pending = 0
  let unranked = 0
  let unavailable = 0
  let bestRank: number | null = null
  let bestTier: RarityTier | null = null

  for (const row of input.holdings) {
    units += row.quantity

    switch (row.rarity.status) {
      case 'ranked':
        ranked += 1
        if (bestRank === null || row.rarity.rank < bestRank) {
          bestRank = row.rarity.rank
          bestTier = rarityTierOf(row.rarity.rank, input.maxRank)
        }
        break
      case 'pending':
        pending += 1
        break
      case 'unranked':
        unranked += 1
        break
      case 'missing':
      case 'failed':
        unavailable += 1
        break
    }
  }

  return {
    rows: input.holdings.length,
    units,
    walletsHolding: input.wallets.filter((wallet) => wallet.tokens > 0).length,
    bestRank,
    bestTier,
    ranked,
    pending,
    unranked,
    unavailable,
  }
}

type RankJob = {
  chain: string
  contractAddress: string
  tokenIds: string[]
}

export async function scanPortfolio(input: {
  slug: string
  wallets: readonly ScanWallet[]
  collapsed?: readonly CollapsedWallet[]
  onSnapshot?: (snapshot: ScanSnapshot) => void
}): Promise<PortfolioScanResult> {
  const collection = await getCollection(input.slug)

  let stats: CollectionStats | null = null
  let ethUsd: number | null = null
  const statsPromise = getCollectionStats(collection.slug).then(
    (value) => {
      stats = value
      return value
    },
    () => null
  )
  const ethPromise = fetchEthUsdtPrice().then(
    (value) => {
      ethUsd = value.price
      return value.price
    },
    () => null
  )

  const holdings = new Map<string, ScanningHolding>()
  const scans = new Map<string, WalletScan>()
  const collapsed = [...(input.collapsed ?? [])]

  function walletResults(): WalletScan[] {
    return input.wallets.flatMap((wallet) => {
      const scan = scans.get(wallet.address)
      return scan ? [scan] : []
    })
  }

  function publish() {
    input.onSnapshot?.({
      collection,
      stats,
      ethUsd,
      wallets: walletResults(),
      collapsed,
      holdings: [...holdings.values()],
    })
  }

  function setRarity(
    key: string,
    rarity: Exclude<RarityState, { status: 'pending' }>
  ) {
    const row = holdings.get(key)
    if (!row) return
    holdings.set(key, { ...row, rarity })
  }

  publish()

  await scanHeldTokens({
    chain: collection.chain,
    slug: collection.slug,
    wallets: input.wallets,
    onToken: ({ key, ...token }) => {
      holdings.set(key, { ...token, id: key, rarity: { status: 'pending' } })
    },
    onWallet: (scan) => {
      scans.set(scan.wallet.address, scan)
      publish()
    },
  })

  const groups = new Map<
    string,
    { chain: string; contractAddress: string; tokenIds: Set<string> }
  >()
  for (const row of holdings.values()) {
    const key = `${row.chain}:${row.contractAddress}`
    const group = groups.get(key) ?? {
      chain: row.chain,
      contractAddress: row.contractAddress,
      tokenIds: new Set<string>(),
    }
    group.tokenIds.add(row.tokenId)
    groups.set(key, group)
  }

  const jobs: RankJob[] = []
  for (const group of groups.values()) {
    const tokenIds = [...group.tokenIds]
    for (let index = 0; index < tokenIds.length; index += NFT_BATCH_MAX) {
      jobs.push({
        chain: group.chain,
        contractAddress: group.contractAddress,
        tokenIds: tokenIds.slice(index, index + NFT_BATCH_MAX),
      })
    }
  }

  await mapLimit(jobs, 4, async (job) => {
    const jobTokens = new Set(job.tokenIds)

    try {
      const ranks = await getNftRankBatch(job)
      const byToken = new Map<string, number | null>(
        ranks.map((entry) => [entry.tokenId, entry.rank] as const)
      )

      for (const [key, row] of holdings) {
        if (
          row.chain !== job.chain ||
          row.contractAddress !== job.contractAddress ||
          !jobTokens.has(row.tokenId)
        ) {
          continue
        }

        if (!byToken.has(row.tokenId)) {
          setRarity(key, { status: 'missing' })
          continue
        }

        const rank = byToken.get(row.tokenId) ?? null
        setRarity(
          key,
          rank === null ? { status: 'unranked' } : { status: 'ranked', rank }
        )
      }
    } catch (failure) {
      const message = scanFailureMessage(failure, 'rarity')

      for (const [key, row] of holdings) {
        if (
          row.chain !== job.chain ||
          row.contractAddress !== job.contractAddress ||
          !jobTokens.has(row.tokenId)
        ) {
          continue
        }
        setRarity(key, { status: 'failed', message })
      }
    }
  })

  await Promise.all([statsPromise, ethPromise])
  publish()

  return {
    collection,
    stats,
    ethUsd,
    wallets: walletResults(),
    collapsed,
    // Every holding contributes to exactly one batch job, so none is pending here.
    holdings: [...holdings.values()] as PortfolioHolding[],
  }
}
