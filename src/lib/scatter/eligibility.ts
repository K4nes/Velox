import { toMessage } from '@/lib/core/message'
import { NO_STATED_CAP } from '@/lib/mint/mint-task'
import type { EligibilityRow } from '@/lib/opensea/eligibility'
import type { DropInfo } from '@/lib/opensea/index'
import { getScatterMintLists } from '@/lib/scatter/index'
import type { StoredWallet } from '@/lib/wallet/wallets'

// The same interval the OpenSea check uses. The API states no published rate limit,
// so the pace is the only lever this loop has against one.
const WALLET_SPACING_MS = 250

// One list read per wallet. A list in the answer is one the wallet can enter, which is
// the whole eligibility question; the cap is the list's configured total, an upper
// bound rather than a remainder.
export async function checkScatterLists(
  drop: DropInfo,
  wallets: StoredWallet[]
): Promise<EligibilityRow[]> {
  const rows: EligibilityRow[] = []
  // One address can be stored in two folders, and the address is the identity the
  // API sees. The dedup keeps one wallet from spending the pace twice.
  const unique = [
    ...new Map(
      wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])
    ).values(),
  ]

  for (const [index, wallet] of unique.entries()) {
    if (index > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, WALLET_SPACING_MS)
      )
    }

    try {
      const lists = await getScatterMintLists(drop.slug, wallet.address)
      const byId = new Map(lists.map((list) => [list.id, list]))
      const stages = drop.stages.map((stage) => {
        const list = byId.get(stage.uuid)
        return {
          stageUuid: stage.uuid,
          label: stage.label || '—',
          eligible: list !== undefined,
          maxMintable:
            list === undefined
              ? '0'
              : String(list.walletLimit ?? NO_STATED_CAP),
          priceWei: stage.priceWei,
        }
      })
      rows.push({
        walletId: wallet.id,
        label: wallet.label,
        address: wallet.address,
        stages,
      })
    } catch (error) {
      rows.push({
        walletId: wallet.id,
        label: wallet.label,
        address: wallet.address,
        stages: [],
        error: toMessage(error),
      })
    }
  }

  return rows
}
