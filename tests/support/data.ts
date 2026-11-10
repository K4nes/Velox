import './env'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { FolderRow, WalletRow } from './seed'

export const FIXED_NOW = 1_760_000_000_000

export function secondWallet(privateKey: string, folderId: string): WalletRow {
  return {
    id: 'wallet-second',
    folderId,
    label: 'second',
    address: privateKeyToAccount(privateKey as `0x${string}`).address,
    privateKey,
    createdAt: FIXED_NOW,
  }
}

/**
 * Wallets for the deterministic mint run. The keys are generated per run, so no
 * committed fixture can sign a transaction that reaches a real chain; the ids
 * sort in list order, which is the order the mint hands out work. The caller
 * supplies the folder the wallets belong to.
 */
export function mintWallets(count: number, folderId: string): WalletRow[] {
  return Array.from({ length: count }, (_, index) => {
    const privateKey = generatePrivateKey()
    return {
      id: `wallet-mint-${String(index).padStart(3, '0')}`,
      folderId,
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

/** A custom RPC connection row for any chain slug the app knows. */
export function customRpc(chain: string, url: string) {
  const endpoint = `${chain}-custom`
  return {
    kind: 'rpc',
    id: `rpc:custom:${endpoint}`,
    name: `${chain} custom RPC`,
    provider: 'custom',
    order: 0,
    autoFallback: true,
    credentials: [],
    endpoints: [{ id: endpoint, chain, url, probe: null }],
    updatedAt: FIXED_NOW,
  }
}

export function robinhoodRpc(url: string) {
  const row = customRpc('robinhood', url)
  return {
    ...row,
    id: 'rpc:custom:robinhood-alchemy',
    name: 'Robinhood Alchemy',
    endpoints: [{ ...row.endpoints[0], id: 'robinhood-alchemy' }],
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

/** The key the PnL card sends to `/api/price/eth-usdt` for its USD figure. */
export function coinmarketcapConnection(apiKey: string) {
  return {
    kind: 'data-api',
    id: 'coinmarketcap',
    name: 'CoinMarketCap',
    order: 1,
    autoFallback: true,
    credentials: [{ id: 'coinmarketcap-key', value: apiKey }],
    updatedAt: FIXED_NOW,
  }
}

export type WalletOptions = {
  label: string
  privateKey: string
  folderId: string
  /** Pin a display address; the key's own address is the default. */
  address?: string
}

/**
 * One wallet row. Nothing identity-like is baked in: the label, key and folder
 * come from the caller, and the address is the key's own unless pinned, so a
 * live scenario cannot import a wallet it did not supply.
 */
export function walletRow(options: WalletOptions): WalletRow {
  return {
    id: `wallet-${options.label}`,
    folderId: options.folderId,
    label: options.label,
    address:
      options.address ??
      privateKeyToAccount(options.privateKey as `0x${string}`).address,
    privateKey: options.privateKey,
    createdAt: FIXED_NOW,
  }
}

/** A folder row for the wallet picker; the id follows the name. */
export function walletFolder(name: string): FolderRow {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
  return { id: `folder-${slug}`, name, createdAt: FIXED_NOW }
}

export type LiveWalletOptions = {
  privateKey: string
  label: string
  folder: string
}

/**
 * The wallet and folder a live scenario seeds, all of them supplied by the
 * caller (the ignored env file in practice). The folder name is what the picker
 * shows, so a test reads it back from here instead of naming one.
 */
export function liveWallet(options: LiveWalletOptions): {
  folder: FolderRow
  wallet: WalletRow
} {
  const folder = walletFolder(options.folder)
  return {
    folder,
    wallet: walletRow({
      label: options.label,
      privateKey: options.privateKey,
      folderId: folder.id,
    }),
  }
}
