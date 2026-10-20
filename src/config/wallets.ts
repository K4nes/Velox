import type { WalletGroup } from '@/components/wallet-select'

export const walletGroups: WalletGroup[] = [
  {
    id: 'main-burners',
    name: 'Main Burners',
    wallets: [
      { id: 'mb-1', name: '0x1a2b…9f01' },
      { id: 'mb-2', name: '0x3c4d…7e02' },
    ],
  },
  {
    id: 'wallet-burners',
    name: 'wallet burners',
    wallets: [
      { id: 'wb-1', name: '0x5e6f…1a03' },
      { id: 'wb-2', name: '0x7g8h…2b04' },
      { id: 'wb-3', name: '0x9i0j…3c05' },
    ],
  },
]
