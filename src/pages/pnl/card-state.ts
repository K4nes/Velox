import { useSyncExternalStore } from 'react'
import { readStoredImages, type CardImage } from '@/lib/card-images'
import type { CollectionInfo } from '@/lib/opensea'
import type { PnlStats } from '@/lib/pnl-trades'
import { fetchEthUsdtPrice } from '@/lib/price'
import type { Format, ImagePosition } from './card-preview'

export const MAX_IMAGES = 3

export type PnlRead = {
  key: string
  version: number
  stats: PnlStats | null
  truncated: boolean
  unpriced: boolean
  error: string | null
  at: number
}

type State = {
  collectionUrl: string
  collection: CollectionInfo | null
  walletIds: string[]
  format: Format
  uploads: CardImage[]
  activeImageId: string | null
  positions: Record<string, ImagePosition>
  version: number
  read: PnlRead | null
  written: { at: number; price: number | null; saved: boolean } | null
  quote: { price: number | null; loading: boolean; at: number }
}

let state: State = {
  collectionUrl: '',
  collection: null,
  walletIds: [],
  format: 'Landscape',
  uploads: readStoredImages().slice(0, MAX_IMAGES),
  activeImageId: null,
  positions: {},
  version: 0,
  read: null,
  written: null,
  quote: { price: null, loading: false, at: 0 },
}

const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

// The route unmounts this page, so the card outlives it here at module scope.
// A new collection check overwrites it; nothing else clears it.
export const pnlCard = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  setCollectionUrl(collectionUrl: string) {
    set({ collectionUrl })
  },
  setCollection(collection: CollectionInfo | null) {
    set({ collection })
  },
  setWalletIds(walletIds: string[]) {
    set({ walletIds })
  },
  setFormat(format: Format) {
    set({ format })
  },
  setUploads(update: (current: CardImage[]) => CardImage[]) {
    set({ uploads: update(state.uploads).slice(0, MAX_IMAGES) })
  },
  setActiveImageId(activeImageId: string | null) {
    set({ activeImageId })
  },
  setPosition(id: string, position: ImagePosition) {
    set({ positions: { ...state.positions, [id]: position } })
  },
  bumpVersion() {
    set({ version: state.version + 1 })
  },
  setRead(read: PnlRead) {
    set({ read })
  },
  markSaved(at: number, price: number | null) {
    set({ written: { at, price, saved: true } })
  },
  markFailed(at: number) {
    set({ written: { at, price: null, saved: false } })
  },
  async loadQuote(force = false) {
    const { quote } = state
    if (quote.loading) return
    if (!force && quote.price !== null && Date.now() - quote.at < 60_000) return

    set({ quote: { ...quote, loading: true } })
    try {
      const next = await fetchEthUsdtPrice()
      set({ quote: { price: next.price, loading: false, at: Date.now() } })
    } catch {
      set({ quote: { ...state.quote, loading: false } })
    }
  },
}

export function usePnlCard() {
  return useSyncExternalStore(pnlCard.subscribe, pnlCard.get)
}
