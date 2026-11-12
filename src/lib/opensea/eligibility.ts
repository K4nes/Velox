import { privateKeyToAccount } from 'viem/accounts'
import { signInNonce, signInToken } from '@/lib/chain/transport'
import type { TransportReply } from '@/lib/chain/transport'
import { cachedEligibilityToken, forgetEligibilityToken } from '@/lib/opensea/eligibility-token-cache'
import { toMessage } from '@/lib/core/message'
import {
  getCollection,
  getDrop,
  getEligibility,
} from '@/lib/opensea/index'
import { openSeaStatus } from '@/lib/opensea/error'
import type { DropInfo, EligibilityResponse } from '@/lib/opensea/index'
import { toPrivateKeyHex } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'

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

export async function getEligibilityToken(
  privateKey: string
): Promise<{ token: string; expiresAt: number }> {
  const account = privateKeyToAccount(toPrivateKeyHex(privateKey))

  const nonce = await readAuth<{ message: string }>(
    signInNonce(account.address)
  )
  const signature = await account.signMessage({ message: nonce.message })

  return readAuth<{ token: string; expiresAt: number }>(
    signInToken({ message: nonce.message, signature })
  )
}

// Every failure the chain reports arrives as a status plus a message, so a
// broken sign-in reads the same in the browser lane and the installed app.
async function readAuth<T>(reply: Promise<TransportReply>): Promise<T> {
  const { status, body } = await reply
  const failure = body as { error?: string } | null

  if (status < 200 || status >= 300 || failure === null) {
    throw new Error(failure?.error ?? 'Sign-in request failed')
  }

  return body as T
}

// One eligibility request per wallet, plus the sign-in calls the auth proxy makes
// ahead of it. That request carries both the wallet's bearer token and the
// configured API key, and opensea.ts derives its keyAuth flag from the absence of
// an `authorization` header, so a 429 here cannot rotate to the next key. It
// waits out its retry budget, or gives up at once when the server asks for a wait
// longer than that budget allows, and either way that wallet's row fails. Pacing
// is the only lever this loop has, and 250 ms is a guess at a limit this repo does
// not record, not a published number.
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
      let token = await cachedEligibilityToken(wallet.address, () =>
        getEligibilityToken(wallet.privateKey)
      )
      let response: EligibilityResponse
      try {
        response = await getEligibility(drop.slug, token)
      } catch (error) {
        // A cached token can be revoked before its expiresAt. Drop it once so
        // the next check signs in again instead of failing every row.
        const status = openSeaStatus(error)
        if (status === 401 || status === 403) {
          forgetEligibilityToken(wallet.address)
          token = await cachedEligibilityToken(wallet.address, () =>
            getEligibilityToken(wallet.privateKey)
          )
          response = await getEligibility(drop.slug, token)
        } else {
          throw error
        }
      }

      // The eligibility response only covers the stages this wallet can enter,
      // so the row is built from the drop's full schedule and each stage is
      // matched against that response.
      // The two endpoints disagree on formatting: `/drops/{slug}` sends an
      // undashed `uuid`, `/eligibility` sends a dashed `stage_uuid`. Matching
      // the raw strings makes every cap zero, which reads as "not eligible".
      const stages =
        drop.stages.length > 0
          ? drop.stages.map((dropStage) => {
              const match = response.stages.find(
                (stage) =>
                  stage.stageUuid.replaceAll('-', '').toLowerCase() ===
                  dropStage.uuid.replaceAll('-', '').toLowerCase()
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
        error: toMessage(error),
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
