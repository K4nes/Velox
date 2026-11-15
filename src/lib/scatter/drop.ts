import { parseUnits } from 'viem'
import { chainByChainId } from '@/config/chains'
import type { ChainEntry } from '@/config/chains'
import { traceMint } from '@/lib/mint/mint-trace'
import { byStageStart } from '@/lib/opensea/index'
import type { DropInfo, DropStage } from '@/lib/opensea/index'
import { ScatterError } from '@/lib/scatter/error'
import {
  SCATTER_NATIVE_CURRENCY,
  getScatterCollection,
  getScatterMintLists,
} from '@/lib/scatter/index'
import type { ScatterCollection, ScatterMintList } from '@/lib/scatter/index'

// Scatter's own marker on the drop shape. OpenSea's SeaDrop restriction reads this
// value and must not apply to a Scatter collection, which mints any contract type.
export const SCATTER_DROP_TYPE = 'scatter_v1'

// Scatter deploys to more chains than Velox signs for. The name is what the refusal
// says, so an operator knows which chain to move away from.
const SCATTER_CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  143: 'Monad',
  999: 'Hyperliquid',
  4326: 'MegaETH',
  4663: 'Robinhood Chain',
  5000: 'Mantle',
  8453: 'Base',
  33139: 'ApeChain',
  42161: 'Arbitrum',
  57073: 'Ink',
}

export async function getScatterDrop(slug: string): Promise<DropInfo> {
  const collection = await getScatterCollection(slug)
  const chain = chainByChainId(collection.chainId)
  // The collection names its chain before any list or wallet is read, so an
  // unsignable chain is refused while nothing has been spent on it.
  if (!chain) {
    throw new ScatterError(
      422,
      'unsupported-chain',
      `Scatter collection "${collection.name || slug}" is on ${chainLabel(collection.chainId)}, which Velox cannot sign for.`
    )
  }

  const lists = await getScatterMintLists(slug)
  return dropFromScatter(collection, lists, slug, chain)
}

function chainLabel(chainId: number): string {
  const name = SCATTER_CHAIN_NAMES[chainId]
  return name ? `${name} (chain ${chainId})` : `chain ${chainId}`
}

// A mint list is carried as a mint stage, so the picker, caps and run keep working
// without a second phase type.
export function dropFromScatter(
  collection: ScatterCollection,
  lists: ScatterMintList[],
  slug: string,
  chain: ChainEntry
): DropInfo {
  const stages = lists.map((list) => stageFromList(list, chain)).sort(byStageStart)
  const now = Date.now()
  const active =
    stages.find(
      (stage) =>
        (!stage.startTime || Date.parse(stage.startTime) <= now) &&
        (!stage.endTime || Date.parse(stage.endTime) > now)
    ) ?? null
  const next =
    stages.find(
      (stage) => stage.startTime !== '' && Date.parse(stage.startTime) > now
    ) ?? null

  const drop: DropInfo = {
    slug,
    name: collection.name,
    chain: chain.slug,
    contractAddress: collection.address,
    source: 'scatter',
    dropType: SCATTER_DROP_TYPE,
    isMinting: active !== null,
    maxSupply: String(collection.maxItems),
    totalSupply: String(collection.numItems),
    activeStage: active,
    nextStage: next,
    stages,
  }
  traceMint({
    kind: 'drops',
    slug: drop.slug,
    activeStageUuid: drop.activeStage?.uuid ?? null,
  })
  return drop
}

function stageFromList(list: ScatterMintList, chain: ChainEntry): DropStage {
  let priceWei: string
  try {
    priceWei = parseUnits(list.tokenPrice, list.decimals).toString()
  } catch {
    throw new ScatterError(
      502,
      'unexpected-response',
      `Scatter list "${list.name || list.id}" states an unreadable price: ${list.tokenPrice}`
    )
  }

  const symbol =
    list.currencySymbol !== ''
      ? list.currencySymbol
      : list.currencyAddress === SCATTER_NATIVE_CURRENCY
        ? chain.currency.symbol
        : ''

  return {
    uuid: list.id,
    stageType: SCATTER_DROP_TYPE,
    label: list.name,
    priceWei,
    // Empty means the list states no cap. The shared quantity ceiling already reads
    // an absent cap as no ceiling.
    maxPerWallet: list.walletLimit === null ? '' : String(list.walletLimit),
    startTime: list.startTime,
    // Empty means no end; nothing downstream renders or compares a date.
    endTime: list.endTime,
    ...(list.unitSize > 1 ? { unitSize: list.unitSize } : {}),
    ...(symbol !== ''
      ? { currency: { symbol, decimals: list.decimals } }
      : {}),
  }
}
