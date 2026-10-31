import { OPENSEA_BASE_URL, httpExchange, readErrorBody } from '../src/lib/http.ts'
import { buildSiweMessage, parseSiweMessage } from './siwe.ts'

export const AUTH_PATHS: readonly string[] = ['/api/auth/nonce', '/api/auth/token']

type Upstream =
  | { ok: true; body: unknown; cookie: string }
  | { ok: false; status: number; message: string; response: Response }

export async function handleAuth(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url)
  if (!AUTH_PATHS.includes(pathname)) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  if (req.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 })
  }
  return pathname === '/api/auth/nonce' ? handleNonce(req) : handleToken(req)
}

async function handleNonce(req: Request): Promise<Response> {
  const address = readField(tryParse(await req.text()), 'address')
  if (typeof address !== 'string' || address === '') {
    return Response.json({ error: 'address is required' }, { status: 400 })
  }

  const issued = await callOpensea('/auth/siwe/nonce', { address })
  if (!issued.ok) return issued.response
  const nonce = readField(issued.body, 'nonce')
  if (typeof nonce !== 'string' || nonce === '') return unexpected('/auth/siwe/nonce')

  const message = buildSiweMessage({ address, chainId: 1, nonce, issuedAt: new Date().toISOString() })
  return Response.json({ message })
}

async function handleToken(req: Request): Promise<Response> {
  const payload = tryParse(await req.text())
  const message = readField(payload, 'message')
  const signature = readField(payload, 'signature')
  if (typeof message !== 'string' || typeof signature !== 'string') {
    return Response.json({ error: 'message and signature are required' }, { status: 400 })
  }

  const fields = parseSiweMessage(message)
  if (fields === null) {
    return Response.json({ error: 'message does not match the OpenSea sign-in layout' }, { status: 400 })
  }

  const verified = await callOpensea('/auth/siwe/verify', { message: fields, signature, chainArch: 'EVM' })
  if (!verified.ok) return verified.response
  const cookie = verified.cookie

  const created = await createToken(cookie)
  if (!created.ok) return created.response
  const patId = readField(created.body, 'id')

  try {
    const pat = readField(created.body, 'token')
    if (typeof pat !== 'string' || pat === '') return unexpected('/auth/tokens')
    const exchanged = await callOpensea('/auth/tokens/exchange', { subjectToken: pat })
    if (!exchanged.ok) return exchanged.response
    const token = readField(exchanged.body, 'accessToken')
    if (typeof token !== 'string' || token === '') return unexpected('/auth/tokens/exchange')
    // The exchange schema makes expiresIn optional; the official SDK assumes an hour.
    const expiresIn = readField(exchanged.body, 'expiresIn')
    const lifetime = typeof expiresIn === 'number' ? expiresIn : 3600

    return Response.json({ token, expiresAt: Date.now() + lifetime * 1000 })
  } finally {
    // The minted JWT outlives the PAT, so revoking cannot break the client. Left
    // alone, every sign-in would keep a read:eligibility PAT alive for a day.
    // Not awaited: a stalled revoke must not delay a token that already exists.
    if (typeof patId === 'string' && patId !== '') void revokeToken(patId, cookie)
  }
}

async function createToken(cookie: string): Promise<Upstream> {
  const body = { label: 'velox', scopes: ['read:eligibility'], expiresInDays: 1 }
  const first = await callOpensea('/auth/tokens', body, { cookie })

  // A fresh SIWE session intermittently answers 400 "Requested scopes exceed
  // account entitlement" before the account is entitled; the same cookie
  // succeeds on the next call. Measured on 2 of 5 fresh sessions.
  if (first.ok || first.status !== 400) return first
  if (!first.message.includes('exceed account entitlement')) return first

  return callOpensea('/auth/tokens', body, { cookie })
}

async function revokeToken(id: string, cookie: string): Promise<void> {
  try {
    await httpExchange(`${OPENSEA_BASE_URL}/auth/tokens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { accept: 'application/json', cookie },
    })
  } catch {
    // A failed revoke leaves the PAT alive; the client already holds its token.
  }
}

async function callOpensea(path: string, payload: unknown, headers: Record<string, string> = {}): Promise<Upstream> {
  const outcome = await httpExchange(`${OPENSEA_BASE_URL}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })

  if (outcome.kind === 'timeout') {
    return failed(504, 504, 'OpenSea did not respond in time')
  }
  if (outcome.kind === 'network') {
    return failed(502, 502, 'OpenSea request failed')
  }
  if (outcome.kind === 'ok') {
    return { ok: true, body: outcome.body, cookie: outcome.cookie }
  }

  const failure = readErrorBody(outcome.body)
  const message =
    failure.message ?? (outcome.text.trim() || `${outcome.status} ${outcome.statusText}`.trim())
  return failed(outcome.status, 502, message)
}

function failed(upstreamStatus: number, clientStatus: number, message: string): Upstream {
  return {
    ok: false,
    status: upstreamStatus,
    message,
    response: Response.json({ error: message }, { status: clientStatus }),
  }
}

function readField(source: unknown, key: string): unknown {
  return typeof source === 'object' && source !== null ? (source as Record<string, unknown>)[key] : undefined
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function unexpected(path: string): Response {
  return Response.json({ error: `unexpected response from ${path}` }, { status: 502 })
}
