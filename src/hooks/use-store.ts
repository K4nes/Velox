import { useCallback, useEffect, useRef, useState } from 'react'
import { toMessage } from '@/lib/core/error-message'

type Loaded<T> = {
  version: number
  value: T[]
}

export function useStore<T>(read: () => Promise<T[]>): {
  value: T[]
  loading: boolean
  error: string | null
  reload: () => void
  fail: (failure: unknown) => void
} {
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  })

  useEffect(() => {
    let cancelled = false

    readRef.current()
      .then((value) => {
        if (!cancelled) {
          setLoaded({ version, value })
          setError(null)
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setLoaded({ version, value: [] })
          setError(toMessage(failure))
        }
      })

    return () => {
      cancelled = true
    }
  }, [version])

  const reload = useCallback(() => {
    setVersion((current) => current + 1)
  }, [])

  const fail = useCallback((failure: unknown) => {
    setError(toMessage(failure))
  }, [])

  return {
    value: loaded?.value ?? [],
    // Derived, so a reload flips to loading without a second state to keep in sync.
    loading: loaded === null || loaded.version !== version,
    error,
    reload,
    fail,
  }
}
