import { privateKeyToAccount } from 'viem/accounts'
import { getAll, put, remove } from '@/lib/db'

export type StoredWallet = {
  id: string
  folderId: string
  label: string
  address: string
  privateKey: string
  createdAt: number
}

const PRIVATE_KEY_PATTERN = /^(0[xX])?[0-9a-fA-F]{64}$/

export function toPrivateKeyHex(privateKey: string): `0x${string}` {
  const body = privateKey.trim().replace(/^0x/i, '')
  return `0x${body}` as `0x${string}`
}

export function deriveAddress(privateKey: string): string {
  return privateKeyToAccount(toPrivateKeyHex(privateKey)).address.toLowerCase()
}

export function parseWalletLines(text: string): {
  rows: { label: string; privateKey: string }[]
  errors: string[]
} {
  const rows: { label: string; privateKey: string }[] = []
  const errors: string[] = []

  text.split('\n').forEach((line, index) => {
    const entry = line.trim()
    if (!entry) {
      return
    }

    const separator = entry.indexOf(',')
    const label = separator === -1 ? '' : entry.slice(0, separator).trim()
    const privateKey = separator === -1 ? '' : entry.slice(separator + 1).trim()

    if (separator === -1) {
      errors.push(`Line ${index + 1}: expected name,private key`)
      return
    }
    if (!label) {
      errors.push(`Line ${index + 1}: name missing`)
      return
    }
    if (!privateKey) {
      errors.push(`Line ${index + 1}: private key missing`)
      return
    }
    if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
      errors.push(`Line ${index + 1}: private key must be 64 hex characters, with or without a 0x prefix`)
      return
    }

    try {
      deriveAddress(privateKey)
      rows.push({ label, privateKey })
    } catch {
      errors.push(`Line ${index + 1}: private key is not a valid secp256k1 key`)
    }
  })

  return { rows, errors }
}

export function listWallets(): Promise<StoredWallet[]> {
  return getAll<StoredWallet>('wallets')
}

export async function importWallets(
  folderId: string,
  rows: { label: string; privateKey: string }[],
): Promise<{ imported: number; skipped: number }> {
  const known = new Set(
    (await listWallets())
      .filter((wallet) => wallet.folderId === folderId)
      .map((wallet) => wallet.address)
  )
  let imported = 0
  let skipped = 0

  for (const row of rows) {
    const address = deriveAddress(row.privateKey)
    if (known.has(address)) {
      skipped += 1
      continue
    }
    known.add(address)

    const wallet: StoredWallet = {
      id: uid(),
      folderId,
      label: row.label,
      address,
      privateKey: row.privateKey,
      createdAt: Date.now(),
    }
    await put<StoredWallet>('wallets', wallet)
    imported += 1
  }

  return { imported, skipped }
}

export function removeWallet(id: string): Promise<void> {
  return remove('wallets', id)
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
