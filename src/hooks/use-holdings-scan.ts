import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLiveRead } from '@/hooks/use-live-read'
import {
  resolveScanWallets,
  scanFailureMessage,
  scanHeldTokens,
} from '@/lib/holdings'
import type { HeldToken, WalletScan } from '@/lib/holdings'
import { getCollection, slugFromUrl } from '@/lib/opensea'
import type { CollectionInfo } from '@/lib/opensea'
import { resolveScanTarget } from '@/lib/scan-target'

export type HoldingsScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'ready'; collection: CollectionInfo; scans: WalletScan[] }
  | { status: 'failed'; message: string }

export function useHoldingsScan() {
  const [url, setUrl] = useState('')
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [state, setState] = useState<HoldingsScanState>({ status: 'idle' })
  const [tokens, setTokens] = useState<HeldToken[]>([])
  const [query, setQuery] = useState('')
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  // A scan that resolves after the page unmounted has no state to write, and its
  // toasts would land on whatever page the operator moved to.
  const read = useLiveRead()

  function changeUrl(next: string) {
    if (runningRef.current) return
    setUrl(next)
    setTokens([])
    setState({ status: 'idle' })
  }

  function changeWallets(ids: string[]) {
    if (runningRef.current) return
    setSelectedWallets(ids)
    setTokens([])
    setState({ status: 'idle' })
  }

  async function scan() {
    if (runningRef.current) return

    runningRef.current = true
    const run = read.open()
    setRunning(true)
    setTokens([])
    setState({ status: 'scanning' })

    try {
      const target = await resolveScanTarget(url, selectedWallets)
      if (!run.live()) return
      if (target.status === 'failed') {
        setState({ status: 'failed', message: target.message })
        return
      }

      const resolved = resolveScanWallets(target.wallets)

      let collection: CollectionInfo
      try {
        collection = await getCollection(target.slug)
      } catch (failure) {
        if (!run.live()) return
        const message = scanFailureMessage(failure, 'collection')
        setState({ status: 'failed', message })
        toast.error(message)
        return
      }

      const result = await scanHeldTokens({
        chain: collection.chain,
        slug: collection.slug,
        wallets: resolved.wallets,
      })

      if (!run.live()) return

      setTokens(result.tokens)
      setState({ status: 'ready', collection, scans: result.scans })

      const failed = result.scans.filter((scan) => scan.error !== null)
      if (failed.length > 0) {
        toast.error(
          `${failed.length} of ${result.scans.length} wallets failed — ${failed[0]?.error ?? ''}`
        )
      }
    } catch (failure) {
      if (!run.live()) return
      const message = failure instanceof Error ? failure.message : String(failure)
      setState({ status: 'failed', message })
    } finally {
      if (run.live()) {
        runningRef.current = false
        setRunning(false)
      }
    }
  }

  const term = query.trim().toLowerCase()
  const rows = useMemo(
    () =>
      term === ''
        ? tokens
        : tokens.filter((row) =>
            [
              row.name,
              `#${row.tokenId}`,
              row.tokenId,
              row.owner.label,
              row.owner.address,
            ].some((value) => value.toLowerCase().includes(term))
          ),
    [tokens, term]
  )

  return {
    url,
    selectedWallets,
    state,
    tokens,
    rows,
    totalRows: tokens.length,
    query,
    setQuery,
    running,
    canScan: !running && slugFromUrl(url) !== null && selectedWallets.length > 0,
    collection: state.status === 'ready' ? state.collection : null,
    changeUrl,
    changeWallets,
    scan,
  }
}
