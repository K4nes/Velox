import { OPENSEA_BASE_URL, httpExchange, readErrorBody } from '@/lib/http'
import { PriceRequestError, fetchEthUsdtProbe } from '@/lib/price'

export type ProbeResult =
  | { ok: true; latencyMs: number; warning: string | null; detail: string }
  | { ok: false; status: number | null; error: string }

const RPC_PROBE_TIMEOUT_MS = 8000

export async function probeOpenSeaKey(value: string): Promise<ProbeResult> {
  const started = performance.now()
  const outcome = await httpExchange(`${OPENSEA_BASE_URL}/collections?limit=1`, {
    headers: { accept: 'application/json', 'x-api-key': value },
  })
  const latencyMs = Math.round(performance.now() - started)

  if (outcome.kind === 'timeout') {
    return { ok: false, status: null, error: 'Timed out' }
  }
  if (outcome.kind === 'network') {
    return { ok: false, status: null, error: describe(outcome.error) }
  }
  if (outcome.kind === 'ok') {
    return { ok: true, latencyMs, warning: null, detail: 'Key accepted' }
  }
  if (outcome.status === 429) {
    return { ok: true, latencyMs, warning: 'rate limited', detail: 'Key accepted' }
  }
  if (outcome.status === 401 || outcome.status === 403) {
    return { ok: false, status: outcome.status, error: 'Key rejected' }
  }

  return {
    ok: false,
    status: outcome.status,
    error:
      readErrorBody(outcome.body).message ??
      `OpenSea request failed with ${outcome.status}`,
  }
}

export async function probeRpcEndpoint(url: string): Promise<ProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RPC_PROBE_TIMEOUT_MS)
  const started = performance.now()

  let response: Response
  let text: string
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      }),
      signal: controller.signal,
    })
    text = await response.text()
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: controller.signal.aborted
        ? `No answer within ${RPC_PROBE_TIMEOUT_MS / 1000}s`
        : describe(error),
    }
  } finally {
    clearTimeout(timer)
  }

  const latencyMs = Math.round(performance.now() - started)
  const payload = parseJson(text)
  const failure = read(payload, 'error')
  // A node that hangs up mid-method still answers 200 with an `error` member,
  // so the JSON-RPC envelope decides, not the HTTP status.
  if (failure !== undefined) {
    return { ok: false, status: response.status, error: describeRpcError(failure) }
  }

  const result = read(payload, 'result')
  if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) {
    return {
      ok: false,
      status: response.status,
      error: response.ok
        ? 'Unexpected response'
        : `Endpoint answered ${response.status}`,
    }
  }

  return {
    ok: true,
    latencyMs,
    warning: null,
    detail: `Block ${Number.parseInt(result, 16)}`,
  }
}

export async function probeCmcKey(value: string): Promise<ProbeResult> {
  const started = performance.now()

  try {
    const quote = await fetchEthUsdtProbe(value)
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      warning: null,
      detail: `ETH ${formatPrice(quote.price)}`,
    }
  } catch (error) {
    if (
      error instanceof PriceRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      return { ok: false, status: error.status, error: 'Key rejected' }
    }
    return {
      ok: false,
      status: error instanceof PriceRequestError ? error.status : null,
      error: describe(error),
    }
  }
}

function formatPrice(price: number): string {
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function describeRpcError(error: unknown): string {
  const message = read(error, 'message')
  return typeof message === 'string' && message !== ''
    ? message
    : 'Endpoint rejected the request'
}

function describe(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'Request failed'
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function read(source: unknown, key: string): unknown {
  return typeof source === 'object' && source !== null
    ? (source as Record<string, unknown>)[key]
    : undefined
}
