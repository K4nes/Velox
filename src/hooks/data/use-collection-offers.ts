import { useCallback, useEffect, useMemo, useState } from 'react'

import { usePageStore } from '@/hooks/use-page-store'
import { toMessage } from '@/lib/core/message'
import type { PageStore } from '@/lib/core/page-store'
import { assembleOfferBook } from '@/lib/offers/instant-sell'
import type { OfferBook, OfferLadder } from '@/lib/offers/instant-sell'
import { getCollectionOffers } from '@/lib/opensea/index'

export type OffersState =
  | { status: 'idle' }
  | { status: 'loading'; book: OfferBook | null }
  | { status: 'ready'; book: OfferBook }
  | { status: 'failed'; book: OfferBook | null; message: string }

export type OffersFields = {
  offers: OffersState
  offersCurrency: string | null
}

const NO_LADDERS: readonly OfferLadder[] = []

export function useCollectionOffers(
  collection: { slug: string; chain: string } | null,
  store: PageStore<OffersFields>
): {
  state: OffersState
  ladders: readonly OfferLadder[]
  ladder: OfferLadder | null
  currency: string | null
  setCurrency: (address: string) => void
  refresh: () => void
} {
  const fields = usePageStore(store)
  // Local because a refresh is a page gesture: the book it replaces already
  // outlives the page in the store.
  const [refreshToken, setRefreshToken] = useState(0)

  const slug = collection?.slug ?? null
  const chain = collection?.chain ?? null

  useEffect(() => {
    if (!slug || !chain) {
      store.set({ offers: { status: 'idle' } })
      return
    }

    let cancelled = false
    const previous = store.get().offers
    const book = previous.status === 'idle' ? null : previous.book
    store.set({
      offers: {
        status: 'loading',
        book: book?.slug === slug && book.chain === chain ? book : null,
      },
    })

    void getCollectionOffers({ slug, chain }).then(
      ({ offers, truncated }) => {
        if (cancelled) return
        store.set({
          offers: {
            status: 'ready',
            book: assembleOfferBook({
              slug,
              chain,
              fetchedAtSec: Math.floor(Date.now() / 1000),
              truncated,
              offers,
            }),
          },
        })
      },
      (failure) => {
        if (cancelled) return
        const message = toMessage(failure)
        const current = store.get().offers
        const kept = current.status === 'idle' ? null : current.book
        store.set({
          offers: {
            status: 'failed',
            book: kept?.slug === slug && kept.chain === chain ? kept : null,
            message,
          },
        })
      }
    )

    return () => {
      cancelled = true
    }
  }, [slug, chain, refreshToken, store])

  const ladders =
    fields.offers.status === 'idle'
      ? NO_LADDERS
      : (fields.offers.book?.ladders ?? NO_LADDERS)

  const ladder = useMemo(
    () =>
      ladders.find(
        (entry) => entry.currency.address === fields.offersCurrency
      ) ??
      ladders[0] ??
      null,
    [ladders, fields.offersCurrency]
  )

  const setCurrency = useCallback(
    (address: string) => {
      store.set({ offersCurrency: address })
    },
    [store]
  )

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1)
  }, [])

  return {
    state: fields.offers,
    ladders,
    ladder,
    currency: fields.offersCurrency,
    setCurrency,
    refresh,
  }
}
