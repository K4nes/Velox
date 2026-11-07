import { useCallback, useEffect, useState } from 'react'

type Loaded<T> = {
  version: number
  value: T[]
}

function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
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

  // `read` is a dependency, so it has to be stable: a module-level function or
  // a useCallback, never an inline arrow.
  useEffect(() => {
    let cancelled = false

    read()
      .then((value) => {
        if (!cancelled) {
          setLoaded({ version, value })
          setError(null)
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setLoaded({ version, value: [] })
          setError(message(failure))
        }
      })

    return () => {
      cancelled = true
    }
  }, [read, version])

  const reload = useCallback(() => {
    setVersion((current) => current + 1)
  }, [])

  const fail = useCallback((failure: unknown) => {
    setError(message(failure))
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
