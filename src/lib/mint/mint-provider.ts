import type { CollectionSource } from '@/lib/collection-source'
import { buildMintTransaction, getDrop } from '@/lib/opensea/index'
import type { DropInfo, MintTransaction } from '@/lib/opensea/index'
import { cachedEligibilityToken } from '@/lib/opensea/eligibility-token-cache'
import { checkEligibility, getEligibilityToken } from '@/lib/opensea/eligibility'
import type { EligibilityResult } from '@/lib/opensea/eligibility'
import { getScatterDrop } from '@/lib/scatter/drop'
import { checkScatterEligibility } from '@/lib/scatter/eligibility'
import { buildScatterMint } from '@/lib/scatter/mint'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type { DropInfo, DropStage, MintTransaction } from '@/lib/opensea/index'

// One wallet's mint build. The stage identifier is the provider's own stage or list,
// carried from the task so a build names exactly one.
export type MintBuild = {
  drop: DropInfo
  stageUuid: string
  minter: string
  quantity: number
}

type MintProvider = {
  fetchDrop: (slug: string) => Promise<DropInfo>
  readEligibility: (
    slug: string,
    wallets: StoredWallet[]
  ) => Promise<EligibilityResult>
  buildTransaction: (input: MintBuild) => Promise<MintTransaction>
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
    buildTransaction: ({ drop, minter, quantity }) =>
      buildMintTransaction(drop.slug, minter, quantity),
    warmAuth: async (wallet) => {
      await cachedEligibilityToken(wallet.address, () =>
        getEligibilityToken(wallet.privateKey)
      )
    },
  },
  // The build takes no credential, so the entry has no warm step: omitting it is what
  // keeps a Scatter task off the OpenSea sign-in chain.
  scatter: {
    fetchDrop: getScatterDrop,
    readEligibility: checkScatterEligibility,
    buildTransaction: ({ drop, stageUuid, minter, quantity }) =>
      buildScatterMint({ drop, listId: stageUuid, minter, quantity }),
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
  input: MintBuild
): Promise<MintTransaction> {
  return providers[input.drop.source].buildTransaction(input)
}
