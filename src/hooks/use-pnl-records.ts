import { useCallback, useEffect, useState } from 'react'
import { listPnlRecords } from '@/lib/pnl-records'
import type { PnlRecord } from '@/lib/pnl-records'

type Loaded = {
  version: number
  records: PnlRecord[]
  error: string | null
}

export function usePnlRecords(): {
  records: PnlRecord[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false

    listPnlRecords()
      .then((records) => {
        if (!cancelled) {
          setLoaded({ version, records, error: null })
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setLoaded({
            version,
            records: [],
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
    records: loaded?.records ?? [],
    loading: loaded === null || loaded.version !== version,
    error: loaded?.error ?? null,
    reload,
  }
}
