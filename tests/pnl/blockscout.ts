import type { Browser } from '@e2e-dev/web'
import type { JsonValue } from 'e2e'

/** One token transfer as the test supplies it, before the raw shape. */
export type ExplorerTransfer = {
  hash: string
  blockNumber: number
  from: string
  to: string
  token: string
  standard: 'ERC-20' | 'ERC-721' | 'ERC-1155'
  tokenId?: string
  /** Base units for an ERC-20, the quantity for an ERC-1155. */
  units?: number
  decimals?: number
}

/** One transaction and the token legs inside it. */
export type ExplorerTransaction = {
  hash: string
  from: string
  to: string
  value?: bigint
  internals?: { from: string; to: string; value: bigint }[]
  transfers?: ExplorerTransfer[]
}

export type BlockscoutMock = {
  readonly urls: readonly string[]
}

function transferJson(entry: ExplorerTransfer): Record<string, JsonValue> {
  let total: Record<string, JsonValue>
  if (entry.standard === 'ERC-721') {
    total = { token_id: entry.tokenId ?? null }
  } else if (entry.standard === 'ERC-1155') {
    total = {
      token_id: entry.tokenId ?? null,
      value: String(entry.units ?? 1),
      decimals: '0',
    }
  } else {
    total = { value: String(entry.units ?? 0), decimals: String(entry.decimals ?? 18) }
  }

  return {
    transaction_hash: entry.hash,
    block_number: entry.blockNumber,
    from: { hash: entry.from },
    to: { hash: entry.to },
    total,
    token: {
      address_hash: entry.token,
      decimals: String(entry.decimals ?? 0),
    },
    token_type: entry.standard,
  }
}

function page(items: Record<string, JsonValue>[]): JsonValue {
  return { items, next_page_params: null }
}

/**
 * Answers the Blockscout routes the PnL card reads: the address transfer list
 * filtered by standard, then each transaction's root, internals and token legs.
 * A path no test supplied is a 404, so a fixture gap fails the read instead of
 * reaching the network. The address list is served newest first, as the
 * explorer does.
 */
export async function mockBlockscout(
  browser: Browser,
  options: {
    transfers: Record<string, ExplorerTransfer[]>
    transactions: Record<string, ExplorerTransaction>
  },
): Promise<BlockscoutMock> {
  const urls: string[] = []

  await browser.route(/^https:\/\/robinhoodchain\.blockscout\.com\/api\/v2\//, async (route) => {
    const url = new URL(route.request.url)
    urls.push(url.toString())
    const segments = url.pathname.split('/').filter(Boolean)
    const kind = segments[2]
    const id = segments[3]?.toLowerCase()
    const leaf = segments[4]

    if (kind === 'addresses' && id !== undefined && leaf === 'token-transfers') {
      const types = url.searchParams.get('type')?.split(',') ?? []
      const token = url.searchParams.get('token')?.toLowerCase()
      const items = (options.transfers[id] ?? []).filter(
        (entry) =>
          (types.length === 0 || types.includes(entry.standard)) &&
          (token === undefined || entry.token.toLowerCase() === token),
      )
      await route.fulfill({ status: 200, json: page(items.map(transferJson)) })
      return
    }

    if (kind === 'transactions' && id !== undefined) {
      const transaction = options.transactions[id]
      if (transaction === undefined) {
        await route.fulfill({ status: 404, json: { message: 'unmocked transaction' } })
        return
      }

      if (leaf === 'internal-transactions') {
        const items = (transaction.internals ?? []).map((entry) => ({
          from: { hash: entry.from },
          to: { hash: entry.to },
          value: entry.value.toString(),
        }))
        await route.fulfill({ status: 200, json: page(items) })
        return
      }

      if (leaf === 'token-transfers') {
        const items = (transaction.transfers ?? []).map(transferJson)
        await route.fulfill({ status: 200, json: page(items) })
        return
      }

      if (leaf === undefined) {
        await route.fulfill({
          status: 200,
          json: {
            from: { hash: transaction.from },
            to: { hash: transaction.to },
            value: (transaction.value ?? 0n).toString(),
          },
        })
        return
      }
    }

    await route.fulfill({ status: 404, json: { message: 'unmocked route' } })
  })

  return {
    get urls() {
      return urls
    },
  }
}
