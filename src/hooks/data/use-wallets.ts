import { useStore } from '@/hooks/data/use-store'
import type { WalletGroup } from '@/components/wallet-select'
import { getAll } from '@/lib/db/db'
import type { FolderRecord } from '@/lib/wallet/wallet-model'
import type { StoredWallet } from '@/lib/wallet/wallets'

const UNASSIGNED_ID = 'unassigned'

function buildGroups(folders: FolderRecord[], wallets: StoredWallet[]): WalletGroup[] {
  const groups: WalletGroup[] = [...folders]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      wallets: [],
    }))
  const byId = new Map<string, WalletGroup>(groups.map((group) => [group.id, group]))
  const unassigned = byId.get(UNASSIGNED_ID)
  const orphan: WalletGroup = unassigned ?? {
    id: UNASSIGNED_ID,
    name: 'Unassigned',
    wallets: [],
  }

  for (const wallet of [...wallets].sort((a, b) => a.createdAt - b.createdAt)) {
    const group = byId.get(wallet.folderId) ?? orphan
    group.wallets.push({ id: wallet.id, name: wallet.label, address: wallet.address })
  }

  if (!unassigned && orphan.wallets.length > 0) {
    groups.push(orphan)
  }

  return groups
}

async function readWalletGroups(): Promise<WalletGroup[]> {
  const [folders, wallets] = await Promise.all([
    getAll<FolderRecord>('folders'),
    getAll<StoredWallet>('wallets'),
  ])

  return buildGroups(folders, wallets)
}

export function useWalletGroups(): {
  groups: WalletGroup[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const { value, loading, error, reload } = useStore(readWalletGroups)

  return { groups: value, loading, error, reload }
}
