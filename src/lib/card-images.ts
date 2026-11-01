export type CardImage = { id: string; src: string; label: string }

const STORAGE_KEY = 'pnl-card-images'

// The card is drawn at most 959px wide, so a longer edge only costs storage.
// localStorage tops out near 5 MB per origin and a data URL is ~4/3 of the
// bytes, which leaves room for three images at this size.
const MAX_EDGE = 1280
const QUALITY = 0.82

function isCardImage(value: unknown): value is CardImage {
  if (typeof value !== 'object' || value === null) return false
  const image = value as Record<string, unknown>
  return (
    typeof image.id === 'string' &&
    typeof image.src === 'string' &&
    typeof image.label === 'string'
  )
}

export function readStoredImages(): CardImage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCardImage)
  } catch {
    // Storage can throw in private mode and the value can be hand-edited.
    return []
  }
}

export function persistImages(images: CardImage[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(images))
    return true
  } catch {
    // Quota is the only expected failure; the card still shows the image.
    return false
  }
}

// The card survives a reload, so a blob: URL would dangle. Encode to a data
// URL instead, shrunk to the size the card can actually show.
export async function readImageFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('Canvas is not available')
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', QUALITY)
  } finally {
    bitmap.close()
  }
}
