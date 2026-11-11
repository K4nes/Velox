import { useCallback } from 'react'
import { useStore } from '@/hooks/data/use-store'
import { deletePnlRecord, listPnlRecords } from '@/lib/pnl/pnl-records'
import type { PnlRecord } from '@/lib/pnl/pnl-records'

export function usePnlRecords(): {
  records: PnlRecord[]
  loading: boolean
  error: string | null
  reload: () => void
  remove: (id: string) => void
} {
  const { value, loading, error, reload, fail } = useStore(listPnlRecords)

  // Re-read only after the delete lands, so a failure keeps the row on screen.
  const remove = useCallback(
    (id: string) => {
      deletePnlRecord(id).then(reload).catch(fail)
    },
    [fail, reload]
  )

  return { records: value, loading, error, reload, remove }
}
