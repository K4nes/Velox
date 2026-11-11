import { toMessage } from '@/lib/core/message'
import { openSeaStatus } from '@/lib/opensea/error'

// Two variants rather than one, because check rows and scan rows name the failure
// differently. Check copy is the wording operators already know.
export function mintFailureMessage(
  error: unknown,
  step: 'drop' | 'eligibility'
): string {
  const status = openSeaStatus(error)
  if (status === 0) {
    return 'OpenSea API key is not set. Add one in Settings.'
  }
  if (status === 401) {
    return 'OpenSea API key rejected. Update it in Settings.'
  }
  if (status === 404) {
    return step === 'drop'
      ? 'No drop found for this collection'
      : 'Eligibility check failed'
  }

  return `Check failed — ${toMessage(error)}`
}

// Scan rows keep the per-wallet message bare, because the caller counts them, and prefix
// only the collection step.
export function scanFailureMessage(
  error: unknown,
  step: 'collection' | 'wallet' | 'rarity'
): string {
  const status = openSeaStatus(error)
  if (status === 0) return toMessage(error)
  if (status === 401) return 'OpenSea API key rejected'
  if (status === 404 && step === 'collection') {
    return 'Collection not found'
  }

  const message = toMessage(error)
  return step === 'collection' ? `Collection failed — ${message}` : message
}
