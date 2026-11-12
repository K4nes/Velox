import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * What both lanes hand back. `status` is the HTTP status the relay route or the
 * in-app command chose, so a caller acts on 401, 403, 429 or 504 the same way
 * whichever lane it runs in.
 */
export type TransportReply = { status: number; body: unknown }

export function signInNonce(address: string): Promise<TransportReply> {
  return relay('/api/auth/nonce', { address }, 'sign_in_nonce')
}

export function signInToken(input: {
  message: string
  signature: string
}): Promise<TransportReply> {
  return relay('/api/auth/token', input, 'sign_in_token')
}

// An installed app has no dev server behind it, and the sign-in chain needs a
// cookie the webview cannot read, so the same call runs as a Tauri command in
// Rust. Both lanes answer `{ status, body }`.
type AuthCommand = 'sign_in_nonce' | 'sign_in_token'

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
