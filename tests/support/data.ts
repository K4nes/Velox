import './env'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { FolderRow, WalletRow } from './seed'

export const FIXED_NOW = 1_760_000_000_000

/** `rh8`'s address: the value the run row is keyed on. */
export const RH8_ADDRESS = '0x74c8f5ab3649c280fb986fde3ee13da4dd1f5210'

export const RH8_FOLDER: FolderRow = {
  id: 'folder-rh8',
  name: 'Robinhood',
  createdAt: FIXED_NOW,
}

export function rh8Wallet(privateKey: string): WalletRow {
  return {
    id: 'wallet-rh8',
    folderId: RH8_FOLDER.id,
    label: 'rh8',
    address: RH8_ADDRESS,
    privateKey,
    createdAt: FIXED_NOW,
  }
}

/**
 * Wallets for the deterministic mint run. The keys are generated per run, so no
 * committed fixture can sign a transaction that reaches a real chain; the ids
 * sort in list order, which is the order the mint hands out work.
 */
export function mintWallets(count: number): WalletRow[] {
  return Array.from({ length: count }, (_, index) => {
    const privateKey = generatePrivateKey()
    return {
      id: `wallet-mint-${String(index).padStart(3, '0')}`,
      folderId: RH8_FOLDER.id,
      label: `mint-${index}`,
      address: privateKeyToAccount(privateKey).address,
      privateKey,
      createdAt: FIXED_NOW,
    }
  })
}

/** The transfer destination: a second wallet, supplied through the env pair. */
export const DEST_ADDRESS = '0xe94768E4e34Dd61d50099f33440e8FC2f903CCAC'

export const DEST_FOLDER: FolderRow = {
  id: 'folder-dest',
  name: 'Destinations',
  createdAt: FIXED_NOW,
}

export function destWallet(privateKey: string): WalletRow {
  return {
    id: 'wallet-dest',
    folderId: DEST_FOLDER.id,
    label: 'dest',
    address: DEST_ADDRESS,
    privateKey,
    createdAt: FIXED_NOW,
  }
}

export function robinhoodRpc(url: string) {
  return {
    kind: 'rpc',
    id: 'rpc:custom:robinhood-alchemy',
    name: 'Robinhood Alchemy',
    provider: 'custom',
    order: 0,
    autoFallback: true,
    credentials: [],
    endpoints: [{ id: 'robinhood-alchemy', chain: 'robinhood', url, probe: null }],
    updatedAt: FIXED_NOW,
  }
}

export function openseaConnection(apiKey: string) {
  return {
    kind: 'data-api',
    id: 'opensea',
    name: 'OpenSea',
    order: 0,
    autoFallback: true,
    credentials: [{ id: 'opensea-key', value: apiKey }],
    updatedAt: FIXED_NOW,
  }
}
