import type { Browser } from '@e2e-dev/web'
import type { JsonValue } from 'e2e'

/** One request the mocked endpoint saw, in arrival order. */
export type RpcCall = {
  method: string
  params: readonly JsonValue[]
}

export type RpcMock = {
  readonly calls: readonly RpcCall[]
  /** How many requests carried `method`. */
  count(method: string): number
}

/** A 32-byte ABI word, for `eth_call` answers that decode to a number. */
export function word(value: bigint | number | string): string {
  return `0x${BigInt(value).toString(16).padStart(64, '0')}`
}

export const TEST_TX_HASH = `0x${'11'.repeat(32)}`

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`

function blockFixture(): JsonValue {
  return {
    number: '0x1',
    hash: `0x${'00'.repeat(32)}`,
    parentHash: `0x${'00'.repeat(32)}`,
    nonce: '0x0000000000000000',
    sha3Uncles: `0x${'00'.repeat(32)}`,
    logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: `0x${'00'.repeat(32)}`,
    stateRoot: `0x${'00'.repeat(32)}`,
    receiptsRoot: `0x${'00'.repeat(32)}`,
    miner: ZERO_ADDRESS,
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x0',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    timestamp: '0x1',
    transactions: [],
    uncles: [],
    baseFeePerGas: '0x1',
    mixHash: `0x${'00'.repeat(32)}`,
  }
}

function receiptFixture(txHash: string): JsonValue {
  return {
    transactionHash: txHash,
    transactionIndex: '0x0',
    blockHash: `0x${'00'.repeat(32)}`,
    blockNumber: '0x1',
    from: ZERO_ADDRESS,
    to: ZERO_ADDRESS,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    type: '0x2',
    effectiveGasPrice: '0x1',
  }
}

/**
 * Answers a JSON-RPC endpoint. Every method is answered from this list unless
 * `results` overrides it; an unknown method throws, so a fixture gap fails the
 * step instead of passing as fake data. `eth_call` is looked up by the first
 * four bytes of its calldata in `ethCall`, because two contracts can share a
 * method. Writes are refused unless `allowWrites` is set.
 */
export async function mockRpc(
  browser: Browser,
  options: {
    url: string | RegExp
    chainId?: string
    balance?: string
    /** Calldata selector (`0x12345678`) to ABI-encoded result. */
    ethCall?: Readonly<Record<string, string>>
    /** Overrides for the default answer of any method. */
    results?: Readonly<Record<string, JsonValue>>
    allowWrites?: boolean
    txHash?: string
  },
): Promise<RpcMock> {
  const calls: RpcCall[] = []
  const txHash = options.txHash ?? TEST_TX_HASH

  function defaultResult(method: string, params: readonly JsonValue[]): JsonValue {
    const overridden = options.results?.[method]
    if (overridden !== undefined) return overridden

    switch (method) {
      case 'eth_chainId':
        return options.chainId ?? '0x1237'
      case 'eth_getBalance':
        return options.balance ?? '0x6f05b59d3b20000'
      case 'eth_blockNumber':
        return '0x10'
      case 'eth_getBlockByNumber':
        return blockFixture()
      case 'eth_getTransactionCount':
        return '0x0'
      case 'eth_estimateGas':
        return '0x30d40'
      case 'eth_maxPriorityFeePerGas':
      case 'eth_gasPrice':
        return '0x3b9aca00'
      case 'eth_getCode':
        return '0x'
      case 'eth_getTransactionReceipt':
        return receiptFixture(String(params[0] ?? txHash))
      case 'eth_call': {
        const request = params[0]
        let data: unknown
        if (
          typeof request === 'object' &&
          request !== null &&
          !Array.isArray(request) &&
          'data' in request
        ) {
          data = request.data
        }
        const selector = typeof data === 'string' ? data.slice(0, 10) : '0x'
        const result = options.ethCall?.[selector]
        if (result === undefined) {
          throw new Error(`unmocked eth_call selector ${selector}`)
        }
        return result
      }
      default:
        throw new Error(`unmocked RPC method: ${method}`)
    }
  }

  await browser.route(options.url, async (route) => {
    const body = JSON.parse(route.request.postData ?? '{}') as {
      id?: JsonValue
      method?: string
      params?: JsonValue[]
    }
    const method = body.method ?? ''
    const params = body.params ?? []
    calls.push({ method, params })

    if (method === 'eth_sendRawTransaction') {
      if (options.allowWrites !== true) {
        throw new Error('eth_sendRawTransaction requires allowWrites')
      }
      await route.fulfill({
        status: 200,
        json: { jsonrpc: '2.0', id: body.id ?? null, result: txHash },
      })
      return
    }

    const result = defaultResult(method, params)
    await route.fulfill({
      status: 200,
      json: { jsonrpc: '2.0', id: body.id ?? null, result },
    })
  })

  return {
    calls,
    count: (method) => calls.filter((call) => call.method === method).length,
  }
}
