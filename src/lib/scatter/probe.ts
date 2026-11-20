import { sleep } from '@/lib/core/async'
import { WALLET_READ_SPACING_MS } from '@/lib/core/concurrency'
import { toMessage } from '@/lib/core/message'
import type { PublicClient } from 'viem'
import type { MintAllowance } from '@/lib/mint/allowance'
import { allowanceLog } from '@/lib/mint/allowance'
import type { ProbeStatus } from '@/lib/mint/mint-task'
import {
  readTokenAllowance,
  readTokenBalance,
  readTokenMetadata,
} from '@/lib/chain/erc20'
import { clientFor } from '@/lib/chain/tx'
import type { DropInfo } from '@/lib/opensea/index'
import { isErc20Refusal } from '@/lib/scatter/erc20-refusal'
import { ScatterError } from '@/lib/scatter/error'
import { buildScatterMint } from '@/lib/scatter/mint'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type ScatterProbeVerdict = {
  status: ProbeStatus
  error?: string
  allowances?: MintAllowance[]
  // The quantity the verdict priced. A later, larger task quantity no longer holds.
  quantity?: number
}

const TOKEN_ID_REFUSAL = /token[\s_-]*id\b/i
const TOKEN_ID_IS_MISSING =
  /\b(?:missing|absent|required|requires?|must be (?:provided|specified|set)|not (?:provided|specified|set|found)|needs?)\b/i

// A missing token ID is a fix in the task, not a wallet failure. Scatter states it in
// its own words, which the row carries unchanged. A token ID the wallet simply does
// not hold is not this refusal, so it stays on the row as a plain failure.
export function isMissingTokenIdRefusal(error: unknown): boolean {
  if (!(error instanceof ScatterError)) return false
  if (TOKEN_ID_REFUSAL.test(error.code) && /missing/i.test(error.code)) {
    return true
  }
  return (
    TOKEN_ID_REFUSAL.test(error.message) &&
    TOKEN_ID_IS_MISSING.test(error.message)
  )
}

// One free build per wallet, paced like the list read. The build returns unsigned
// calldata, so a successful answer says the list accepts the wallet. A token-priced
// build also names an allowance, which the probe reads on chain: the row is blocked
// when the wallet lacks the token and needs approval when it lacks the allowance.
// A native build reads neither and stays eligible.
export async function probeScatterMint(input: {
  drop: DropInfo
  listId: string
  wallets: readonly StoredWallet[]
  quantity: number
  isCurrent?: () => boolean
}): Promise<Map<string, ScatterProbeVerdict>> {
  const verdicts = new Map<string, ScatterProbeVerdict>()
  let client: PublicClient | null = null
  let clientError: string | null = null
  // One metadata read per token, not one per wallet: every wallet's build names the
  // same token, and the answer is display-only.
  const metadataCache = new Map<
    string,
    Promise<{ symbol?: string; decimals?: number }>
  >()

  for (const [index, wallet] of input.wallets.entries()) {
    if (index > 0) await sleep(WALLET_READ_SPACING_MS)
    if (input.isCurrent && !input.isCurrent()) break

    try {
      // The build stays at quantity 1 because it proves list eligibility; the task's
      // quantity only scales the requirement the on-chain reads are compared to.
      const build = await buildScatterMint({
        drop: input.drop,
        listId: input.listId,
        minter: wallet.address,
        quantity: 1,
      })

      if (build.allowances.length === 0) {
        verdicts.set(wallet.id, {
          status: 'eligible',
          allowances: [],
          quantity: input.quantity,
        })
        continue
      }

      // One client for the chain, not one per wallet. A chain Velox cannot reach
      // fails every wallet that needs an allowance read with the same message.
      if (client === null && clientError === null) {
        try {
          client = await clientFor(input.drop.chain)
        } catch (error) {
          clientError = toMessage(error)
        }
      }
      if (client === null) {
        verdicts.set(wallet.id, {
          status: 'failed',
          error: clientError ?? 'No RPC configured for this chain.',
          allowances: build.allowances,
          quantity: input.quantity,
        })
        continue
      }

      const metadataClient = client
      try {
        // A token the build did not name costs base units in the panel. Reading its
        // own metadata keeps the row readable without changing the verdict.
        const allowances = await Promise.all(
          build.allowances.map(async (allowance) => {
            if (
              allowance.symbol !== undefined &&
              allowance.decimals !== undefined
            ) {
              return allowance
            }
            const key = allowance.token.toLowerCase()
            let pending = metadataCache.get(key)
            if (pending === undefined) {
              pending = readTokenMetadata({
                client: metadataClient,
                token: allowance.token,
              })
              metadataCache.set(key, pending)
            }
            const metadata = await pending
            return {
              ...allowance,
              symbol: allowance.symbol ?? metadata.symbol,
              decimals: allowance.decimals ?? metadata.decimals,
            }
          })
        )

        const reads = []
        for (const allowance of allowances) {
          const required = allowance.amount * BigInt(input.quantity)
          const balance = await readTokenBalance({
            client: metadataClient,
            token: allowance.token,
            owner: wallet.address as `0x${string}`,
          })
          const approved = await readTokenAllowance({
            client: metadataClient,
            token: allowance.token,
            owner: wallet.address as `0x${string}`,
            spender: allowance.spender,
          })
          reads.push({ allowance, required, balance, approved })
        }

        if (reads.some((read) => read.balance < read.required)) {
          verdicts.set(wallet.id, {
            status: 'blocked',
            error: allowanceLog(reads, 'blocked'),
            allowances,
            quantity: input.quantity,
          })
        } else if (reads.some((read) => read.approved < read.required)) {
          verdicts.set(wallet.id, {
            status: 'needs-approval',
            error: allowanceLog(reads, 'needs-approval'),
            allowances,
            quantity: input.quantity,
          })
        } else {
          verdicts.set(wallet.id, {
            status: 'eligible',
            allowances,
            quantity: input.quantity,
          })
        }
      } catch (error) {
        verdicts.set(wallet.id, {
          status: 'failed',
          error: toMessage(error),
          allowances: build.allowances,
          quantity: input.quantity,
        })
      }
    } catch (error) {
      verdicts.set(wallet.id, {
        status:
          isErc20Refusal(error) || isMissingTokenIdRefusal(error)
            ? 'blocked'
            : 'failed',
        error: toMessage(error),
        quantity: input.quantity,
      })
    }
  }

  return verdicts
}
