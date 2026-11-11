import { formatEther } from 'viem'
import { chainBySlug } from '@/config/chains'
import { balanceKey, type BalanceMap } from '@/lib/wallet/balance-key'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type WalletProfile = {
  id: string
  label: string
  address: string
  balance: bigint | null
}

export type Folder = {
  id: string
  name: string
  wallets: WalletProfile[]
}

export type FolderRecord = {
  id: string
  name: string
  createdAt: number
}

export function formatBalance(value: bigint, symbol: string) {
  return `${Number(formatEther(value)).toFixed(4)} ${symbol}`
}

export function walletCount(count: number) {
  return `${count} wallet${count === 1 ? '' : 's'}`
}

export function folderBalance(folder: Folder) {
  return folder.wallets.reduce(
    (total, wallet) => total + (wallet.balance ?? 0n),
    0n
  )
}

// A balance nobody read is not a zero balance, so the folder reports it as
// unknown instead of claiming "Unfunded".
export function folderState(folder: Folder): 'funded' | 'unfunded' | 'unknown' {
  if (folder.wallets.some((wallet) => wallet.balance === null)) {
    return 'unknown'
  }
  return folderBalance(folder) > 0n ? 'funded' : 'unfunded'
}

export function uid() {
  try {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // randomUUID throws on non-secure origins; fall through to the fallback id.
  }
  return `wallet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const CHAIN_STORAGE_KEY = 'wallet-chain'

export function readStoredChain(): string | null {
  try {
    const stored = localStorage.getItem(CHAIN_STORAGE_KEY)
    if (stored && chainBySlug(stored)) return stored
  } catch {
    // Storage can throw in private mode; fall back to the first chain.
  }
  return null
}

export function persistChain(slug: string) {
  try {
    localStorage.setItem(CHAIN_STORAGE_KEY, slug)
  } catch {
    // Storage can throw in private mode; the selection still applies.
  }
}

export function toFolders(
  folderRecords: FolderRecord[],
  walletRecords: StoredWallet[],
  balances: BalanceMap,
  chainSlug: string
): Folder[] {
  return folderRecords.map((folder) => ({
    id: folder.id,
    name: folder.name,
    wallets: walletRecords
      .filter((wallet) => wallet.folderId === folder.id)
      .map((wallet) => ({
        id: wallet.id,
        label: wallet.label,
        address: wallet.address,
        balance: balances.get(balanceKey(chainSlug, wallet.address)) ?? null,
      })),
  }))
}
