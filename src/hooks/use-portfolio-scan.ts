import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { slugFromUrl } from '@/lib/opensea'
import { resolveScanWallets, scanFailureMessage } from '@/lib/holdings'
import { scanPortfolio } from '@/lib/portfolio'
import type {
  PortfolioScanResult,
  PortfolioScanState,
  PortfolioTableState,
} from '@/lib/portfolio'
import { listWallets } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export function describeTable(
  state: PortfolioScanState,
  collectionName: string
): PortfolioTableState {
  switch (state.status) {
    case 'idle':
      return {
        status: 'idle',
        message: 'Scan this collection to see what the selected wallets hold.',
      }
    case 'scanning':
      return state.snapshot.holdings.length > 0
        ? { status: 'ready' }
        : {
            status: 'loading',
            message: `Scanning ${state.snapshot.collection.name || collectionName}…`,
          }
    case 'ready': {
      if (state.result.holdings.length > 0) {
        return { status: 'ready' }
      }

      const failed = state.result.wallets.filter((wallet) => wallet.error !== null)
      if (failed.length === 0) {
        return {
          status: 'empty',
          message: `None of the selected wallets hold ${state.result.collection.name || collectionName}.`,
        }
      }

      return {
        status: 'error',
        message: `${failed.length} of ${state.result.wallets.length} wallets could not be read. ${failed[0]?.error ?? ''}`,
      }
    }
    case 'failed':
      return { status: 'error', message: state.message }
  }
}

function toastResult(result: PortfolioScanResult) {
  const failed = result.wallets.filter((wallet) => wallet.error !== null)
  if (failed.length > 0) {
    toast.error(
      `${failed.length} of ${result.wallets.length} wallets failed — ${failed[0]?.error ?? ''}`
    )
    return
  }

  const unavailable = result.holdings.filter(
    (row) => row.rarity.status === 'missing' || row.rarity.status === 'failed'
  )
  if (unavailable.length === 0) return

  const firstFailure = unavailable.find((row) => row.rarity.status === 'failed')
  const message =
    firstFailure?.rarity.status === 'failed' ? firstFailure.rarity.message : 'Not found'
  toast.error(
    `${unavailable.length} ${unavailable.length === 1 ? 'token' : 'tokens'} could not be ranked — ${message}`
  )
}

export function usePortfolioScan() {
  const [url, setUrl] = useState('')
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [state, setState] = useState<PortfolioScanState>({ status: 'idle' })
  const [starting, setStarting] = useState(false)
  const runRef = useRef(0)
  const runningRef = useRef(false)

  useEffect(() => {
    return () => {
      runRef.current += 1
    }
  }, [])

  function reset() {
    runRef.current += 1
    setState({ status: 'idle' })
  }

  function changeUrl(next: string) {
    setUrl(next)
    reset()
  }

  function changeWallets(ids: string[]) {
    setSelectedWallets(ids)
    reset()
  }

  async function scan() {
    if (runningRef.current) return

    runningRef.current = true
    setStarting(true)
    const run = runRef.current + 1
    runRef.current = run
    const current = () => runRef.current === run

    try {
      const slug = slugFromUrl(url)
      if (!slug) {
        if (current()) {
          setState({
            status: 'failed',
            message: 'Collection URL not recognised',
          })
        }
        return
      }

      let records: StoredWallet[]
      try {
        records = await listWallets()
      } catch (failure) {
        if (current()) {
          setState({
            status: 'failed',
            message: failure instanceof Error ? failure.message : String(failure),
          })
        }
        return
      }

      if (!current()) return

      const resolved = resolveScanWallets(
        records.filter((wallet) => selectedWallets.includes(wallet.id))
      )
      if (resolved.wallets.length === 0) {
        setState({
          status: 'failed',
          message: 'No saved wallet matches the selection',
        })
        return
      }

      let result: PortfolioScanResult
      try {
        result = await scanPortfolio({
          slug,
          wallets: resolved.wallets,
          collapsed: resolved.collapsed,
          onSnapshot: (snapshot) => {
            if (!current()) return
            setState({ status: 'scanning', snapshot })
          },
        })
      } catch (failure) {
        if (current()) {
          setState({
            status: 'failed',
            message: scanFailureMessage(failure, 'collection'),
          })
        }
        return
      }

      if (!current()) return
      setState({ status: 'ready', result })
      toastResult(result)
    } finally {
      runningRef.current = false
      setStarting(false)
    }
  }

  const collectionName =
    state.status === 'scanning'
      ? state.snapshot.collection.name || state.snapshot.collection.slug
      : state.status === 'ready'
        ? state.result.collection.name || state.result.collection.slug
        : ''

  return {
    url,
    selectedWallets,
    state,
    tableState: describeTable(state, collectionName),
    running: starting || state.status === 'scanning',
    changeUrl,
    changeWallets,
    scan,
  }
}
