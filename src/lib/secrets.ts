import { chainBySlug } from '@/config/chains'
import { get, put, remove } from '@/lib/db'

export type SecretId = 'opensea-api-key' | `rpc:${string}`

type SecretRecord = { id: string; value: string }

export async function readSecret(id: SecretId): Promise<string> {
  const record = await get<SecretRecord>('secrets', id)
  return record?.value ?? ''
}

export async function writeSecret(id: SecretId, value: string): Promise<void> {
  if (!value) {
    await remove('secrets', id)
    return
  }

  await put<SecretRecord>('secrets', { id, value })
}

export async function resolveRpcUrl(slug: string): Promise<string> {
  const stored = await readSecret(`rpc:${slug}`)
  if (stored) {
    return stored
  }

  const fallback = chainBySlug(slug)?.rpcUrl
  if (fallback) {
    return fallback
  }

  throw new Error(`No RPC configured for ${slug}`)
}
