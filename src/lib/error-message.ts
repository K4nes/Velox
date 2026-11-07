import { OpenSeaError } from '@/lib/opensea'

// RPC endpoints can carry an API key in the path, and viem's transport errors
// quote the full URL. Anything shown to the operator or stored on a row goes
// through here first.
export function redactUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, '[rpc]')
}

// The one way to turn a thrown value into copy, so redaction cannot be
// forgotten at a call site.
export function toMessage(error: unknown): string {
  return redactUrls(error instanceof Error ? error.message : String(error))
}

// Two variants rather than one, because check rows and scan rows name the
// failure differently. Check copy is the wording operators already know.
export function mintFailureMessage(
  error: unknown,
  step: 'collection' | 'drop' | 'eligibility'
): string {
  if (error instanceof OpenSeaError) {
    if (error.status === 0) {
      return 'OpenSea API key is not set. Add one in Settings.'
    }
    if (error.status === 401) {
      return 'OpenSea API key rejected. Update it in Settings.'
    }
    if (error.status === 404) {
      if (step === 'collection') return 'Collection not found'
      if (step === 'drop') return 'No drop found for this collection'
      return 'Eligibility check failed'
    }
  }

  return `Check failed — ${toMessage(error)}`
}

// Scan rows keep the per-wallet message bare, because the caller counts them,
// and prefix only the collection step.
export function scanFailureMessage(
  error: unknown,
  step: 'collection' | 'wallet' | 'rarity'
): string {
  if (error instanceof OpenSeaError) {
    if (error.status === 0) return toMessage(error)
    if (error.status === 401) return 'OpenSea API key rejected'
    if (error.status === 404 && step === 'collection') {
      return 'Collection not found'
    }
  }

  const message = toMessage(error)
  return step === 'collection' ? `Collection failed — ${message}` : message
}
