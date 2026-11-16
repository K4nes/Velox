import {
  COLLECTION_NOT_RECOGNISED,
  readRefusalFor,
  resolveCollectionSource,
} from '@/lib/collection-source'
import type { CollectionSource } from '@/lib/collection-source'
import { toMessage } from '@/lib/core/message'
import { listWallets } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type ScanTarget =
  | {
      status: 'ready'
      slug: string
      source: CollectionSource
      wallets: StoredWallet[]
    }
  | { status: 'failed'; message: string }

// The preamble every scan shares: the URL has to name a collection, and the
// selection has to name at least one saved wallet, before anything is read.
export async function resolveScanTarget(
  url: string,
  selectedIds: readonly string[]
): Promise<ScanTarget> {
  const collection = resolveCollectionSource(url)
  if (collection === null) {
    return { status: 'failed', message: COLLECTION_NOT_RECOGNISED }
  }

  let records: StoredWallet[]
  try {
    records = await listWallets()
  } catch (failure) {
    return {
      status: 'failed',
      message: toMessage(failure),
    }
  }

  const wallets = records.filter((wallet) => selectedIds.includes(wallet.id))
  if (wallets.length === 0) {
    return { status: 'failed', message: 'No saved wallet matches the selection' }
  }

  return {
    status: 'ready',
    slug: collection.slug,
    source: collection.source,
    wallets,
  }
}

// The entry point the read-only pages call. The refusal is decided before the
// wallet read, so a collection this page cannot serve answers the same way
// whatever is selected. Everything else, including an input that names no
// collection, is the preamble's to answer. Mint Eligibility keeps calling it.
export async function resolveReadTarget(
  url: string,
  selectedIds: readonly string[]
): Promise<ScanTarget> {
  const collection = resolveCollectionSource(url)
  const refusal = collection === null ? null : readRefusalFor(collection)
  if (refusal !== null) {
    return { status: 'failed', message: refusal }
  }

  return resolveScanTarget(url, selectedIds)
}
