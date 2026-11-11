export const OPENSEA_BASE_URL = 'https://api.opensea.io/api/v2'
export const OPENSEA_TIMEOUT_MS = 15_000

export type HttpInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export type HttpOutcome =
  | { kind: 'ok'; body: unknown; cookie: string }
  | { kind: 'timeout' }
  | { kind: 'network'; error: unknown }
  | {
      kind: 'status'
      status: number
      statusText: string
      text: string
      body: unknown
      retryAfterMs: number | null
    }

export async function httpExchange(
  url: string,
  init: HttpInit = {}
): Promise<HttpOutcome> {
  let response: Response
  let text: string
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? OPENSEA_TIMEOUT_MS),
    })
    // Read inside the same try: the deadline stays armed for the body.
    text = await response.text()
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return timedOut ? { kind: 'timeout' } : { kind: 'network', error }
  }

  const body = parseJson(text)
  if (!response.ok) {
    return {
      kind: 'status',
      status: response.status,
      statusText: response.statusText,
      text,
      body,
      retryAfterMs: retryDelayMs(response),
    }
  }

  return { kind: 'ok', body, cookie: cookieHeader(response) }
}

export function readErrorBody(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null) {
    return {}
  }

  const source = body as { errors?: unknown; error?: unknown; message?: unknown }
  const first = Array.isArray(source.errors) ? source.errors[0] : undefined

  if (typeof first === 'string' && first !== '') {
    return { message: first }
  }
  if (typeof source.error === 'string' && source.error !== '') {
    return { message: source.error }
  }
  if (source.error && typeof source.error === 'object') {
    const nested = source.error as { code?: unknown; message?: unknown }
    if (typeof nested.message === 'string' && nested.message !== '') {
      return {
        code: typeof nested.code === 'string' ? nested.code : undefined,
        message: nested.message,
      }
    }
  }
  if (typeof source.message === 'string' && source.message !== '') {
    return { message: source.message }
  }

  return {}
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// A 429 carries `Retry-After` in seconds, and every authenticated response
// carries `X-RateLimit-Reset` as Unix seconds. Waiting a fixed 2s retries into
// the same empty bucket.
function retryDelayMs(response: Response): number | null {
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000

  const reset = Number(response.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    const wait = reset * 1000 - Date.now()
    if (wait > 0) return wait
  }

  return null
}

// getSetCookie returns whole header values, attributes included, so only the
// name=value pairs belong in a request Cookie header. Browsers before Chrome 113
// have no getSetCookie, and the browser client never needed a cookie.
function cookieHeader(response: Response): string {
  if (typeof response.headers.getSetCookie !== 'function') {
    return ''
  }

  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}
