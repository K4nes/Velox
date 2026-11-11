import { useCallback, useEffect, useMemo, useState } from 'react'
import { toMessage } from '@/lib/core/error-message'
import { assembleOfferBook } from '@/lib/instant-sell'
import type { OfferBook, OfferLadder } from '@/lib/instant-sell'
import { getCollectionOffers } from '@/lib/opensea'

export type OffersState =
  | { status: 'idle' }
  | { status: 'loading'; book: OfferBook | null }
  | { status: 'ready'; book: OfferBook }
  | { status: 'failed'; book: OfferBook | null; message: string }

const NO_LADDERS: readonly OfferLadder[] = []

export function useCollectionOffers(
  collection: { slug: string; chain: string } | null
): {
  state: OffersState
  ladders: readonly OfferLadder[]
  ladder: OfferLadder | null
  currency: string | null
  setCurrency: (address: string) => void
  refresh: () => void
} {
  const [state, setState] = useState<OffersState>({ status: 'idle' })
  const [currency, setCurrencyState] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const slug = collection?.slug ?? null
  const chain = collection?.chain ?? null

  useEffect(() => {
    if (!slug || !chain) {
      setState({ status: 'idle' })
      return
    }

    let cancelled = false
    setState((current): OffersState => {
      const book = current.status === 'idle' ? null : current.book
      return {
        status: 'loading',
        book:
          book?.slug === slug && book.chain === chain ? book : null,
      }
    })

    void getCollectionOffers({ slug, chain }).then(
      ({ offers, truncated }) => {
        if (cancelled) return
        setState({
          status: 'ready',
          book: assembleOfferBook({
            slug,
            chain,
            fetchedAtSec: Math.floor(Date.now() / 1000),
            truncated,
            offers,
          }),
        })
      },
      (failure) => {
        if (cancelled) return
        const message = toMessage(failure)
        setState((current): OffersState => {
          const book = current.status === 'idle' ? null : current.book
          return {
            status: 'failed',
            book:
              book?.slug === slug && book.chain === chain ? book : null,
            message,
          }
        })
      }
    )

    return () => {
      cancelled = true
    }
  }, [slug, chain, refreshToken])

  const ladders =
    state.status === 'idle' ? NO_LADDERS : (state.book?.ladders ?? NO_LADDERS)

  const ladder = useMemo(
    () =>
      ladders.find((entry) => entry.currency.address === currency) ??
      ladders[0] ??
      null,
    [ladders, currency]
  )

  const setCurrency = useCallback((address: string) => {
    setCurrencyState(address)
  }, [])

  const refresh = useCallback(() => {
    setRefreshToken((current) => current + 1)
  }, [])

  return { state, ladders, ladder, currency, setCurrency, refresh }
}
