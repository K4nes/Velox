import { sleep } from '@/lib/core/async'
import { WALLET_READ_SPACING_MS } from '@/lib/core/concurrency'
import { toMessage } from '@/lib/core/message'
import type { ProbeStatus } from '@/lib/mint/mint-task'
import type { DropInfo } from '@/lib/opensea/index'
import { isErc20Refusal } from '@/lib/scatter/erc20-refusal'
import { ScatterError } from '@/lib/scatter/error'
import { buildScatterMint } from '@/lib/scatter/mint'
import type { StoredWallet } from '@/lib/wallet/wallets'

export type ScatterProbeVerdict = {
  status: ProbeStatus
  error?: string
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
// calldata, so a successful answer says the list accepts the wallet, and a refusal
// says why before any gas is spent.
export async function probeScatterMint(input: {
  drop: DropInfo
  listId: string
  wallets: readonly StoredWallet[]
  isCurrent?: () => boolean
}): Promise<Map<string, ScatterProbeVerdict>> {
  const verdicts = new Map<string, ScatterProbeVerdict>()

  for (const [index, wallet] of input.wallets.entries()) {
    if (index > 0) await sleep(WALLET_READ_SPACING_MS)
    if (input.isCurrent && !input.isCurrent()) break

    try {
      await buildScatterMint({
        drop: input.drop,
        listId: input.listId,
        minter: wallet.address,
        quantity: 1,
      })
      verdicts.set(wallet.id, { status: 'eligible' })
    } catch (error) {
      verdicts.set(wallet.id, {
        status:
          isErc20Refusal(error) || isMissingTokenIdRefusal(error)
            ? 'blocked'
            : 'failed',
        error: toMessage(error),
      })
    }
  }

  return verdicts
}
