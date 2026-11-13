import { usePageStore } from '@/hooks/use-page-store'
import { readStoredImages, type CardImage } from '@/lib/card/card-images'
import { createPageStore } from '@/lib/core/page-store'
import type { CollectionInfo } from '@/lib/opensea/index'
import type { PnlStats } from '@/lib/pnl/pnl-trades'
import {
  fetchEthUsdtPrice,
  quoteFailure,
  type QuoteFailure,
} from '@/lib/chain/price'
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
  save: { at: number; price: number | null; failed: boolean } | null
  quote: {
    price: number | null
    loading: boolean
    failure: QuoteFailure | null
  }
}

// The route unmounts this page, so the card outlives it here at module scope.
// A new collection check overwrites it; nothing else clears it.
const card = createPageStore<State>(
  {
    collectionUrl: '',
    collection: null,
    walletIds: [],
    format: 'Landscape',
    uploads: readStoredImages().slice(0, MAX_IMAGES),
    activeImageId: null,
    positions: {},
    version: 0,
    read: null,
    save: null,
    quote: { price: null, loading: false, failure: null },
  },
  { retained: true }
)

export const pnlCard = {
  setCollectionUrl(collectionUrl: string) {
    card.set({ collectionUrl })
  },
  setCollection(collection: CollectionInfo | null) {
    card.set({ collection })
  },
  setWalletIds(walletIds: string[]) {
    card.set({ walletIds })
  },
  setFormat(format: Format) {
    card.set({ format })
  },
  setUploads(update: (current: CardImage[]) => CardImage[]) {
    card.set({
      uploads: update(card.get().uploads).slice(0, MAX_IMAGES),
    })
  },
  setActiveImageId(activeImageId: string | null) {
    card.set({ activeImageId })
  },
  setPosition(id: string, position: ImagePosition) {
    card.set({ positions: { ...card.get().positions, [id]: position } })
  },
  bumpVersion() {
    card.set({ version: card.get().version + 1 })
  },
  setRead(read: PnlRead) {
    card.set({ read })
  },
  markSaved(at: number, price: number | null) {
    card.set({ save: { at, price, failed: false } })
  },
  markFailed(at: number) {
    card.set({ save: { at, price: null, failed: true } })
  },
  async loadQuote() {
    const { quote } = card.get()
    if (quote.loading) return

    card.set({ quote: { ...quote, loading: true } })
    try {
      const next = await fetchEthUsdtPrice()
      card.set({
        quote: {
          price: next.price,
          loading: false,
          failure: null,
        },
      })
    } catch (failure) {
      card.set({
        quote: {
          ...card.get().quote,
          loading: false,
          failure: quoteFailure(failure),
        },
      })
    }
  },
}

export function usePnlCard() {
  return usePageStore(card)
}
