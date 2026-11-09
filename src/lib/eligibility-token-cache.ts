// The auth proxy mints a one-hour token through four OpenSea calls. The armed
// fire path used to rebuild it on every check, and that block is the largest
// removable delay before the mint can be signed.
export type EligibilityToken = { token: string; expiresAt: number }

const EXPIRY_MARGIN_MS = 60_000

const tokens = new Map<string, EligibilityToken>()
const pending = new Map<string, Promise<EligibilityToken>>()

export async function cachedEligibilityToken(
  address: string,
  signIn: () => Promise<EligibilityToken>
): Promise<string> {
  const key = address.toLowerCase()
  const now = Date.now()
  const cached = tokens.get(key)
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > now) return cached.token
  if (cached) tokens.delete(key)

  const inFlight = pending.get(key)
  if (inFlight) return (await inFlight).token

  const request = (async () => {
    const entry = await signIn()
    if (entry.expiresAt - EXPIRY_MARGIN_MS > Date.now()) tokens.set(key, entry)
    return entry
  })()
  pending.set(key, request)

  try {
    return (await request).token
  } finally {
    if (pending.get(key) === request) pending.delete(key)
  }
}

export function forgetEligibilityToken(address: string): void {
  tokens.delete(address.toLowerCase())
}
