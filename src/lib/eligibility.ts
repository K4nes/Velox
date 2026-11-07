import { privateKeyToAccount } from 'viem/accounts'
import { getCollection, getDrop, getEligibility } from '@/lib/opensea'
import type { DropInfo } from '@/lib/opensea'
import { toPrivateKeyHex } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export type StageColumn = { uuid: string; label: string }

export type EligibilityRow = {
  walletId: string
  label: string
  address: string
  stages: {
    stageUuid: string
    label: string
    eligible: boolean
    maxMintable: string
    priceWei: string
  }[]
  error?: string
}

export type EligibilityResult = {
  drop: DropInfo
  imageUrl: string
  rows: EligibilityRow[]
}

export type EligibilityTableState =
  | { status: 'error'; message: string }
  | { status: 'empty'; message: string }
  | { status: 'ready'; rows: EligibilityRow[] }

async function postAuth<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null

  if (!response.ok || body === null) {
    throw new Error(body?.error ?? `Auth request to ${path} failed`)
  }

  return body as T
}

export async function getEligibilityToken(
  privateKey: string
): Promise<{ token: string; expiresAt: number }> {
  const account = privateKeyToAccount(toPrivateKeyHex(privateKey))

  const { message } = await postAuth<{ message: string }>('/api/auth/nonce', {
    address: account.address,
  })
  const signature = await account.signMessage({ message })

  return postAuth<{ token: string; expiresAt: number }>('/api/auth/token', {
    address: account.address,
    message,
    signature,
  })
}

// One OpenSea call per wallet. These calls authenticate with the wallet's
// bearer token, not an API key, so the 429 handling in opensea.ts cannot rotate
// to another key for them: it spends its retry budget and then fails that
// wallet's row. The spacing keeps a long wallet list from finding that limit the
// hard way. 250 ms is a conservative floor, not a published number, because the
// provider's per-key limit is not recorded anywhere in this repo.
const ELIGIBILITY_WALLET_SPACING_MS = 250

export async function checkWalletEligibility(
  drop: DropInfo,
  wallets: StoredWallet[]
): Promise<EligibilityRow[]> {
  const rows: EligibilityRow[] = []
  // A key can be stored in two folders as two records, and the address is the
  // identity the API sees. Without this the same wallet is signed in and checked
  // twice against one rate limit bucket.
  const unique = [
    ...new Map(
      wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])
    ).values(),
  ]

  for (const [index, wallet] of unique.entries()) {
    if (index > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, ELIGIBILITY_WALLET_SPACING_MS)
      )
    }

    try {
      const { token } = await getEligibilityToken(wallet.privateKey)
      const response = await getEligibility(drop.slug, token)

      // The eligibility response only covers the stages this wallet can enter,
      // so the row is built from the drop's full schedule and each stage is
      // matched against that response.
      const stages =
        drop.stages.length > 0
          ? drop.stages.map((dropStage) => {
              const match = response.stages.find(
                (stage) => stage.stageUuid === dropStage.uuid
              )
              return {
                stageUuid: dropStage.uuid,
                label: dropStage.label || '—',
                eligible: match?.eligible ?? false,
                maxMintable: match?.maxMintable ?? '0',
                priceWei: match?.priceWei ?? dropStage.priceWei,
              }
            })
          : response.stages.map((stage) => ({
              stageUuid: stage.stageUuid,
              label: stage.stageUuid,
              eligible: stage.eligible,
              maxMintable: stage.maxMintable,
              priceWei: stage.priceWei,
            }))

      rows.push({
        walletId: wallet.id,
        label: wallet.label,
        address: wallet.address,
        stages,
      })
    } catch (error) {
      rows.push({
        walletId: wallet.id,
        label: wallet.label,
        address: wallet.address,
        stages: [],
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return rows
}

export async function checkEligibility(
  slug: string,
  wallets: StoredWallet[]
): Promise<EligibilityResult> {
  const [drop, collection] = await Promise.all([
    getDrop(slug),
    // The image is decoration, so a collection lookup that fails must not take
    // the eligibility result down with it.
    getCollection(slug).catch(() => null),
  ])

  return {
    drop,
    imageUrl: collection?.imageUrl ?? '',
    rows: await checkWalletEligibility(drop, wallets),
  }
}

// A drop can report no stages while its eligibility response still names some,
// so the columns are the union of both, ordered by the drop first.
export function buildStageColumns(result: EligibilityResult): StageColumn[] {
  const columns: StageColumn[] = result.drop.stages.map((stage) => ({
    uuid: stage.uuid,
    label: stage.label || '—',
  }))
  const seen = new Set(columns.map((column) => column.uuid))

  for (const row of result.rows) {
    for (const stage of row.stages) {
      if (seen.has(stage.stageUuid)) continue
      seen.add(stage.stageUuid)
      columns.push({ uuid: stage.stageUuid, label: stage.label || '—' })
    }
  }

  return columns
}
