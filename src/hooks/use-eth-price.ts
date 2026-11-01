import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchEthUsdtPrice } from '@/lib/price'

export function useEthPrice() {
  const [price, setPrice] = useState<number | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const quote = await fetchEthUsdtPrice()
      if (!mounted.current) return
      setPrice(quote.price)
      setUpdatedAt(quote.updatedAt)
    } catch (failure) {
      if (!mounted.current) return
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  return { price, updatedAt, loading, error, refresh }
}
