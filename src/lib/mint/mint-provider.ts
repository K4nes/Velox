import type { CollectionSource } from '@/lib/collection-source'
import { SCATTER_MINT_REFUSAL } from '@/lib/mint/mint-task'
import { buildMintTransaction, getDrop } from '@/lib/opensea/index'
import type { DropInfo, MintTransaction } from '@/lib/opensea/index'
import { cachedEligibilityToken } from '@/lib/opensea/eligibility-token-cache'
import { checkEligibility, getEligibilityToken } from '@/lib/opensea/eligibility'
import type { EligibilityResult } from '@/lib/opensea/eligibility'
import { getScatterDrop } from '@/lib/scatter/drop'
import { checkScatterEligibility } from '@/lib/scatter/eligibility'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type { DropInfo, DropStage, MintTransaction } from '@/lib/opensea/index'

type MintProvider = {
  fetchDrop: (slug: string) => Promise<DropInfo>
  readEligibility: (
    slug: string,
    wallets: StoredWallet[]
  ) => Promise<EligibilityResult>
  buildTransaction?: (
    slug: string,
    minter: string,
    quantity: number
  ) => Promise<MintTransaction>
  warmAuth?: (wallet: StoredWallet) => Promise<void>
}

// The registry is keyed by the source axis, so a third source adds one entry and
// re-types no caller. A provider that omits warmAuth skips the credential step.
// Live OpenSea answers 409 NOT_MINTING to the mint build before a stage opens, so a
// pre-open build stays best effort; the open-time path builds the same calldata.
const providers: Record<CollectionSource, MintProvider> = {
  opensea: {
    fetchDrop: getDrop,
    readEligibility: checkEligibility,
    buildTransaction: buildMintTransaction,
    warmAuth: async (wallet) => {
      await cachedEligibilityToken(wallet.address, () =>
        getEligibilityToken(wallet.privateKey)
      )
    },
  },
  // Scatter lists load here; the mint build belongs to the next issue, so the
  // provider deliberately has no buildTransaction and no credential.
  scatter: {
    fetchDrop: getScatterDrop,
    readEligibility: checkScatterEligibility,
  },
}

export function fetchMintDrop(
  source: CollectionSource,
  slug: string
): Promise<DropInfo> {
  return providers[source].fetchDrop(slug)
}

export function readEligibility(
  source: CollectionSource,
  slug: string,
  wallets: StoredWallet[]
): Promise<EligibilityResult> {
  return providers[source].readEligibility(slug, wallets)
}

export async function warmMintAuth(
  source: CollectionSource,
  wallet: StoredWallet
): Promise<void> {
  await providers[source].warmAuth?.(wallet)
}

export function buildMintTransactionFor(
  drop: DropInfo,
  minter: string,
  quantity: number
): Promise<MintTransaction> {
  const provider = providers[drop.source]
  if (!provider.buildTransaction) {
    return Promise.reject(
      new Error(
        drop.source === 'scatter'
          ? SCATTER_MINT_REFUSAL
          : `Mint building is not available for ${drop.source}.`
      )
    )
  }
  return provider.buildTransaction(drop.slug, minter, quantity)
}
