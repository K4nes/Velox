import { chainBySlug } from '@/config/chains'
import type { ChainEntry } from '@/config/chains'
import { sleep } from '@/lib/core/async'
import { WALLET_READ_SPACING_MS } from '@/lib/core/concurrency'
import { toMessage } from '@/lib/core/message'
import {
  stageLabel,
  type EligibilityResult,
  type EligibilityRow,
} from '@/lib/opensea/eligibility'
import { byStageStart } from '@/lib/opensea/index'
import type { DropInfo, DropStage } from '@/lib/opensea/index'
import { getScatterDrop, stageFromScatterList } from '@/lib/scatter/drop'
import { getScatterMintLists } from '@/lib/scatter/index'
import type { StoredWallet } from '@/lib/wallet/wallets'

// One wallet's turn: the stages its list read granted, or why it failed. A failed read
// contributes no columns and no verdicts, only its error row.
type ScatterWalletRead =
  | { wallet: StoredWallet; stages: DropStage[] }
  | { wallet: StoredWallet; error: string }

// One list read per wallet. A list in the answer is one the wallet can enter, which is
// the whole eligibility question; the cap is the list's configured total, an upper
// bound rather than a remainder.
export async function checkScatterLists(
  drop: DropInfo,
  wallets: StoredWallet[]
): Promise<EligibilityRow[]> {
  // The drop came from getScatterDrop, which refused an unsignable chain. A miss here
  // means the drop was built elsewhere, so refuse rather than price in the wrong symbol.
  const chain = chainBySlug(drop.chain)
  if (!chain) {
    throw new Error(`Scatter drop "${drop.slug}" names an unknown chain: ${drop.chain}`)
  }

  const reads = await readAllWalletGrants(drop, wallets, chain)
  const columns = unionColumns(drop, reads)
  return projectRows(reads, columns)
}

export function uniqueByAddress(wallets: StoredWallet[]): StoredWallet[] {
  // One address can be stored in two folders, and the address is the identity the API
  // sees. The dedup keeps one wallet from spending the pace twice.
  return [
    ...new Map(
      wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])
    ).values(),
  ]
}

async function readAllWalletGrants(
  drop: DropInfo,
  wallets: StoredWallet[],
  chain: ChainEntry
): Promise<ScatterWalletRead[]> {
  const reads: ScatterWalletRead[] = []

  for (const [index, wallet] of uniqueByAddress(wallets).entries()) {
    if (index > 0) {
      await sleep(WALLET_READ_SPACING_MS)
    }

    try {
      const lists = await getScatterMintLists(drop.slug, wallet.address)
      const stages = lists.map((list) => stageFromScatterList(list, chain))
      reads.push({ wallet, stages })
    } catch (error) {
      reads.push({ wallet, error: toMessage(error) })
    }
  }

  return reads
}

function unionColumns(
  drop: DropInfo,
  reads: ScatterWalletRead[]
): DropStage[] {
  // Public stages seed the union, so a list the collection read already mapped keeps
  // that mapping.
  const byId = new Map(drop.stages.map((stage) => [stage.uuid, stage]))
  for (const read of reads) {
    if ('error' in read) continue
    for (const stage of read.stages) {
      if (!byId.has(stage.uuid)) byId.set(stage.uuid, stage)
    }
  }
  return [...byId.values()].sort(byStageStart)
}

function projectRows(
  reads: ScatterWalletRead[],
  columns: DropStage[]
): EligibilityRow[] {
  return reads.map((read) => {
    if ('error' in read) {
      return {
        walletId: read.wallet.id,
        label: read.wallet.label,
        address: read.wallet.address,
        stages: [],
        error: read.error,
      }
    }

    // Absence from this wallet's answer is a verdict, not missing data. Mapping every
    // column makes a checked row unable to omit one.
    const granted = new Map(read.stages.map((stage) => [stage.uuid, stage]))
    return {
      walletId: read.wallet.id,
      label: read.wallet.label,
      address: read.wallet.address,
      stages: columns.map((stage) => {
        const grant = granted.get(stage.uuid)
        return {
          stageUuid: stage.uuid,
          label: stageLabel(stage.label),
          eligible: grant !== undefined,
          maxMintable: grant === undefined ? '0' : grant.maxPerWallet,
          priceWei: grant?.priceWei ?? stage.priceWei,
        }
      }),
    }
  })
}

// The eligibility page checks a collection the same way the mint task does, so a
// Scatter URL gets Scatter rows instead of an OpenSea 404.
export async function checkScatterEligibility(
  slug: string,
  wallets: StoredWallet[]
): Promise<EligibilityResult> {
  const drop = await getScatterDrop(slug)
  return { drop, imageUrl: '', rows: await checkScatterLists(drop, wallets) }
}
