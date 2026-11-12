import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * What both lanes hand back. `status` is the HTTP status the relay route or the
 * in-app command chose: 200 on success, 400 for a bad request, 502 for a refusal
 * or a network failure, 504 for a timeout.
 */
export type TransportReply = { status: number; body: unknown }

export function signInNonce(address: string): Promise<TransportReply> {
  return relay('/api/auth/nonce', { address }, 'auth_nonce')
}

export function signInToken(input: {
  message: string
  signature: string
}): Promise<TransportReply> {
  return relay('/api/auth/token', input, 'auth_token')
}

// An installed app has no dev server behind it, and the sign-in chain needs a
// cookie the webview cannot read, so the same call runs as a Tauri command in
// Rust. Both lanes answer `{ status, body }`.
type AuthCommand = 'auth_nonce' | 'auth_token'

async function relay(
  path: string,
  payload: Record<string, unknown>,
  command: AuthCommand
): Promise<TransportReply> {
  if (isTauri()) return invoke<TransportReply>(command, payload)

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  }
}
