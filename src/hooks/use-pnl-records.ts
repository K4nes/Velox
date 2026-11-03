import { useCallback, useEffect, useState } from 'react'
import { deletePnlRecord, listPnlRecords } from '@/lib/pnl-records'
import type { PnlRecord } from '@/lib/pnl-records'

type Loaded = {
  version: number
  records: PnlRecord[]
}

export function usePnlRecords(): {
  records: PnlRecord[]
  loading: boolean
  error: string | null
  reload: () => void
  remove: (id: string) => void
} {
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    listPnlRecords()
      .then((records) => {
        if (!cancelled) {
          setLoaded({ version, records })
          setError(null)
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setLoaded({ version, records: [] })
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      })

    return () => {
      cancelled = true
    }
  }, [version])

  const reload = useCallback(() => {
    setVersion((current) => current + 1)
  }, [])

  const remove = useCallback((id: string) => {
    deletePnlRecord(id)
      .then(() => {
        setVersion((current) => current + 1)
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure))
      })
  }, [])

  return {
    records: loaded?.records ?? [],
    loading: loaded === null || loaded.version !== version,
    error,
    reload,
    remove,
  }
}
