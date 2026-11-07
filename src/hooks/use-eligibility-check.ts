import { useRef, useState } from 'react'
import { checkEligibility } from '@/lib/eligibility'
import type { EligibilityTableState } from '@/lib/eligibility'
import { slugFromUrl } from '@/lib/opensea'
import { buildSnapshotPayload, marketplaceFromSource } from '@/lib/snapshots'
import type { EligibilitySnapshotPayload } from '@/lib/snapshots'
import { listWallets } from '@/lib/wallets'

export function useEligibilityCheck(onResetSaveError: () => void) {
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [url, setUrl] = useState('')
  const [checked, setChecked] = useState<EligibilitySnapshotPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const runRef = useRef(0)

  const tableState: EligibilityTableState = error
    ? { status: 'error', message: error }
    : selectedWallets.length === 0
      ? { status: 'empty', message: 'Select at least one wallet' }
      : checked
        ? { status: 'ready', rows: checked.rows }
        : { status: 'empty', message: 'No data yet' }

  // An input edit abandons the request that read the old value.
  function invalidateRun() {
    runRef.current += 1
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

    // Read both off the raw input before the first await, so the saved payload
    // describes the URL that produced it.
    const marketplace = marketplaceFromSource(url)
    const slug = slugFromUrl(url)
    setChecked(null)
    onResetSaveError()

    if (!slug) {
      setError('Collection URL not recognised')
      return
    }

    const run = runRef.current + 1
    runRef.current = run
    runningRef.current = true
    setRunning(true)
    setError(null)

    try {
      const wallets = (await listWallets()).filter((wallet) =>
        selectedWallets.includes(wallet.id)
      )
      if (runRef.current !== run) return
      if (wallets.length === 0) {
        setError('No saved wallet matches the selection')
        return
      }
      const result = await checkEligibility(slug, wallets)
      if (runRef.current !== run) return
      setChecked(buildSnapshotPayload(result, slug, marketplace))
    } catch (failure) {
      if (runRef.current !== run) return
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (runRef.current === run) {
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
