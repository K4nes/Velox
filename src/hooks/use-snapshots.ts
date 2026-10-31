import { useCallback, useEffect, useState } from 'react'
import { listSnapshots } from '@/lib/snapshots'
import type { EligibilitySnapshot } from '@/lib/snapshots'

type Loaded = {
  version: number
  snapshots: EligibilitySnapshot[]
  error: string | null
}

export function useSnapshots(): {
  snapshots: EligibilitySnapshot[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false

    listSnapshots()
      .then((records) => {
        if (!cancelled) {
          setLoaded({ version, snapshots: records, error: null })
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setLoaded({
            version,
            snapshots: [],
            error: failure instanceof Error ? failure.message : String(failure),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [version])

  const reload = useCallback(() => {
    setVersion((current) => current + 1)
  }, [])

  return {
    snapshots: loaded?.snapshots ?? [],
    // Derived, so a reload flips to loading without a second state to keep in sync.
    loading: loaded === null || loaded.version !== version,
    error: loaded?.error ?? null,
    reload,
  }
}
