import { slugFromUrl } from '@/lib/opensea'
import { toMessage } from '@/lib/core/error-message'
import { listWallets } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type ScanTarget =
  | { status: 'ready'; slug: string; wallets: StoredWallet[] }
  | { status: 'failed'; message: string }

// The preamble every scan shares: the URL has to name a collection, and the
// selection has to name at least one saved wallet, before anything is read.
export async function resolveScanTarget(
  url: string,
  selectedIds: readonly string[]
): Promise<ScanTarget> {
  const slug = slugFromUrl(url)
  if (slug === null) {
    return { status: 'failed', message: 'Collection URL not recognised' }
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

  return { status: 'ready', slug, wallets }
}
