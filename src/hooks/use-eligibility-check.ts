import { useRef, useState } from 'react'
import { useLiveRead } from '@/hooks/use-live-read'
import { checkEligibility } from '@/lib/eligibility'
import type { EligibilityTableState } from '@/lib/eligibility'
import { resolveScanTarget } from '@/lib/scan-target'
import { buildSnapshotPayload, marketplaceFromSource } from '@/lib/snapshots'
import type { EligibilitySnapshotPayload } from '@/lib/snapshots'

export function useEligibilityCheck(onResetSaveError: () => void) {
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [url, setUrl] = useState('')
  const [checked, setChecked] = useState<EligibilitySnapshotPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const read = useLiveRead()

  const tableState: EligibilityTableState = error
    ? { status: 'error', message: error }
    : selectedWallets.length === 0
      ? { status: 'empty', message: 'Select at least one wallet' }
      : checked
        ? { status: 'ready', rows: checked.rows }
        : { status: 'empty', message: 'No data yet' }

  // An input edit abandons the request that read the old value.
  function invalidateRun() {
    read.abort()
    runningRef.current = false
    setRunning(false)
  }

  function changeUrl(next: string) {
    setUrl(next)
    setChecked(null)
    setError(null)
    onResetSaveError()
    invalidateRun()
  }

  function changeWallets(ids: string[]) {
    setSelectedWallets(ids)
    setChecked(null)
    setError(null)
    onResetSaveError()
    invalidateRun()
  }

  async function check() {
    if (runningRef.current) return

    // Read off the raw input before the first await, so the saved payload
    // describes the URL that produced it.
    const marketplace = marketplaceFromSource(url)
    setChecked(null)
    onResetSaveError()

    runningRef.current = true
    const run = read.open()
    setRunning(true)
    setError(null)

    try {
      const target = await resolveScanTarget(url, selectedWallets)
      if (!run.live()) return
      if (target.status === 'failed') {
        setError(target.message)
        return
      }

      const result = await checkEligibility(target.slug, target.wallets)
      if (!run.live()) return
      setChecked(buildSnapshotPayload(result, target.slug, marketplace))
    } catch (failure) {
      if (!run.live()) return
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (run.live()) {
        runningRef.current = false
        setRunning(false)
      }
    }
  }

  return {
    selectedWallets,
    url,
    checked,
    error,
    running,
    tableState,
    changeUrl,
    changeWallets,
    check,
  }
}
