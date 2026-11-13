// Type imports only: `npm run test:release` loads this file with node type stripping.

import type { HeldToken, WalletScan } from '@/lib/inventory/holdings'
import type { CollectionInfo } from '@/lib/opensea/index'

export type HoldingsScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'ready'; collection: CollectionInfo; scans: WalletScan[] }
  | { status: 'failed'; message: string }

export type HoldingsFields = {
  url: string
  walletIds: string[]
  state: HoldingsScanState
  tokens: HeldToken[]
  query: string
}

export const EMPTY_HOLDINGS: HoldingsFields = {
  url: '',
  walletIds: [],
  state: { status: 'idle' },
  tokens: [],
  query: '',
}
