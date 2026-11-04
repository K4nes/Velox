import { clientFor } from '@/lib/tx'

const CONCURRENCY = 5

export type BalanceMap = Record<string, bigint>

export type BalanceResult = {
  balances: BalanceMap
  failed: string[]
}

export async function fetchBalances(
  chainSlug: string,
  addresses: string[]
): Promise<BalanceResult> {
  if (addresses.length === 0) {
    return { balances: {}, failed: [] }
  }

  const client = await clientFor(chainSlug)
  const balances: BalanceMap = {}
  const failed: string[] = []
  let failure: unknown = null
  let cursor = 0

  const worker = async () => {
    while (cursor < addresses.length) {
      const address = addresses[cursor]
      cursor += 1
      try {
        balances[address.toLowerCase()] = await client.getBalance({
          address: address as `0x${string}`,
        })
      } catch (error) {
        failed.push(address)
        if (failure === null) {
          failure = error
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, addresses.length) }, worker)
  )

  // One rejected call (a rate-limited public RPC) must not wipe the balances
  // that did resolve, so the error surfaces only when nothing came back.
  if (Object.keys(balances).length === 0 && failure !== null) {
    throw failure
  }

  return { balances, failed }
}
