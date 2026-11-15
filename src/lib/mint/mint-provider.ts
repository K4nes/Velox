import { buildMintTransaction, getDrop } from '@/lib/opensea/index'
import type { DropInfo, MintTransaction } from '@/lib/opensea/index'
import { cachedEligibilityToken } from '@/lib/opensea/eligibility-token-cache'
import { getEligibilityToken } from '@/lib/opensea/eligibility'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type { DropInfo, DropStage, MintTransaction } from '@/lib/opensea/index'

type MintProvider = {
  fetchDrop: (slug: string) => Promise<DropInfo>
  buildTransaction: (
    slug: string,
    minter: string,
    quantity: number
  ) => Promise<MintTransaction>
  warmAuth?: (wallet: StoredWallet) => Promise<void>
}

// One provider today. A provider that omits warmAuth skips the credential step.
// Live OpenSea answers 409 NOT_MINTING to the mint build before a stage opens, so a
// pre-open build stays best effort; the open-time path builds the same calldata.
const provider: MintProvider = {
  fetchDrop: getDrop,
  buildTransaction: buildMintTransaction,
  warmAuth: async (wallet) => {
    await cachedEligibilityToken(wallet.address, () =>
      getEligibilityToken(wallet.privateKey)
    )
  },
}

export function fetchMintDrop(slug: string): Promise<DropInfo> {
  return provider.fetchDrop(slug)
}

export async function warmMintAuth(wallet: StoredWallet): Promise<void> {
  await provider.warmAuth?.(wallet)
}

export function buildMintTransactionFor(
  slug: string,
  minter: string,
  quantity: number
): Promise<MintTransaction> {
  return provider.buildTransaction(slug, minter, quantity)
}
