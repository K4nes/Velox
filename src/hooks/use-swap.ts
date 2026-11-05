import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { formatUnits } from 'viem'
import { chainBySlug, chains } from '@/config/chains'
import { useWalletGroups } from '@/hooks/use-wallets'
import { get } from '@/lib/db'
import { failureMessage, readSwapSnapshot } from '@/lib/swap-chain'
import { SWAP_DIRECTION, planSwap, swapGasCost, swapMax, swapVenue } from '@/lib/swap-plan'
import type {
  SwapBalances,
  SwapDirection,
  SwapSnapshot,
} from '@/lib/swap-plan'
import { executeSwap } from '@/lib/swap-run'
import { waitForReceipt } from '@/lib/tx'
import { readStoredChain } from '@/lib/wallet-model'
import { listWallets } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export type SwapWalletRef = { id: string; label: string; address: string }

export type SwapTx = {
  txHash: string
  direction: SwapDirection
  amount: bigint
  symbol: string
}

export type SwapStatus =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'pending'; tx: SwapTx }
  | { phase: 'confirmed'; tx: SwapTx }
  | { phase: 'reverted'; tx: SwapTx }
  | { phase: 'unconfirmed'; tx: SwapTx; message: string }
  | { phase: 'failed'; message: string }

const EMPTY_BALANCES: SwapBalances = { native: null, wrapped: null }

export function useSwap() {
  const { groups } = useWalletGroups()
  const [walletIds, setWalletIds] = useState<string[]>([])
  // Keyed by id so a projection that lands after the picker moved cannot label
  // the new selection with the old address.
  const [projection, setProjection] = useState<{
    id: string
    wallet: SwapWalletRef | null
  } | null>(null)
  const [chainSlug, setChainSlug] = useState(
    () => readStoredChain() ?? chains[0].slug
  )
  const [direction, setDirection] = useState<SwapDirection>('wrap')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState<SwapStatus>({ phase: 'idle' })
  const [snapshotState, setSnapshotState] = useState<{
    key: string
    snapshot: SwapSnapshot
  } | null>(null)
  const [run, setRun] = useState(0)
  const [inFlight, setInFlight] = useState(false)
  const [checking, setChecking] = useState(false)
  const busyRef = useRef(false)
  const checkingRef = useRef(false)
  const readRef = useRef(0)
  const epochRef = useRef(0)

  useEffect(() => {
    const epoch = epochRef.current
    return () => {
      if (epochRef.current === epoch) epochRef.current += 1
      readRef.current += 1
    }
  }, [])

  const selectedId = walletIds[0] ?? ''

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false

    get<StoredWallet>('wallets', selectedId)
      .then((record) => {
        if (cancelled) return
        // record carries the private key; only this public projection may enter state.
        setProjection({
          id: selectedId,
          wallet: record
            ? { id: record.id, label: record.label, address: record.address }
            : null,
        })
      })
      .catch(() => {
        if (!cancelled) setProjection({ id: selectedId, wallet: null })
      })

    return () => {
      cancelled = true
    }
  }, [selectedId])

  const wallet =
    projection && projection.id === selectedId ? projection.wallet : null
  const entry = chainBySlug(chainSlug)
  // The read effect depends on `read`, which closes over `venue`: a fresh venue
  // object per render would re-run the read forever.
  const venue = useMemo(() => swapVenue(entry), [entry])
  const address = wallet?.address ?? ''
  const key = venue && address ? `${venue.chainSlug}:${address}` : ''
  const snapshot = snapshotState?.key === key ? snapshotState.snapshot : null
  const reading = key !== '' && (snapshotState?.key !== key || inFlight)
  const balances = snapshot?.balances ?? EMPTY_BALANCES
  const fees = snapshot?.fees ?? null

  const read = useCallback(async () => {
    if (!venue || !address) return
    const readKey = `${venue.chainSlug}:${address}`
    const ticket = readRef.current + 1
    readRef.current = ticket
    // The spinner has to flip before the request so a refresh click has feedback.
    setInFlight(true)
    const next = await readSwapSnapshot({ venue, address })
    if (readRef.current !== ticket) return
    setSnapshotState({ key: readKey, snapshot: next })
    setInFlight(false)
  }, [venue, address])

  useEffect(() => {
    if (!key) return
    // The effect exists to read the chain, and the flag has to flip before the
    // request so the refresh click paints.
    // oxlint-disable-next-line react/set-state-in-effect
    void read()
  }, [key, run, read])

  const plan = useMemo(
    () => planSwap({ venue, direction, amountText: amount, wallet, snapshot }),
    [venue, direction, amount, wallet, snapshot]
  )

  const max = useMemo(
    () => swapMax({ direction, balances, fees }),
    [direction, balances, fees]
  )

  const op = SWAP_DIRECTION[direction]
  const fromAsset = venue ? venue.assets[op.from] : null
  const toAsset = venue ? venue.assets[op.to] : null
  const locked =
    status.phase === 'submitting' ||
    status.phase === 'pending' ||
    status.phase === 'unconfirmed'
  const canMax = max !== null && max > 0n
  const invalidAmount =
    plan.status === 'blocked' &&
    (plan.reason === 'amount-invalid' ||
      plan.reason === 'insufficient-balance' ||
      plan.reason === 'insufficient-gas')
  const gasCost = useMemo(
    () => (fees ? swapGasCost(fees, direction) : null),
    [fees, direction]
  )

  const refresh = useCallback(() => {
    setRun((current) => current + 1)
  }, [])

  function changeDirection(next: SwapDirection) {
    setDirection(next)
    setStatus({ phase: 'idle' })
  }

  function changeChain(slug: string) {
    setChainSlug(slug)
    setStatus({ phase: 'idle' })
  }

  function changeWallets(ids: string[]) {
    setWalletIds(ids)
    setStatus({ phase: 'idle' })
  }

  function changeAmount(raw: string) {
    if (/^\d*\.?\d*$/.test(raw)) setAmount(raw)
  }

  function applyMax() {
    if (!canMax || !fromAsset) return
    setAmount(formatUnits(max, fromAsset.decimals))
  }

  async function submit() {
    if (busyRef.current) return
    if (plan.status !== 'ready') {
      toast.error(plan.message)
      return
    }

    const id = walletIds[0]
    if (!id) {
      toast.error('Select a wallet.')
      return
    }
    if (!venue) {
      toast.error('No wrapped native token is configured for this chain.')
      return
    }

    busyRef.current = true
    const epoch = epochRef.current
    const live = () => epoch === epochRef.current
    setStatus({ phase: 'submitting' })

    try {
      // Re-read here, never stored: key material stays out of state, and a wallet
      // deleted since selection fails at the click.
      const record = (await listWallets()).find((candidate) => candidate.id === id)
      if (!live()) return
      if (!record) throw new Error('The selected wallet is no longer saved.')

      // The displayed plan is stale the moment it renders; sign only a fresh plan.
      const freshSnapshot = await readSwapSnapshot({
        venue,
        address: record.address,
      })
      if (!live()) return

      readRef.current += 1
      setSnapshotState({
        key: `${venue.chainSlug}:${record.address}`,
        snapshot: freshSnapshot,
      })

      const fresh = planSwap({
        venue,
        direction,
        amountText: amount,
        wallet: { address: record.address },
        snapshot: freshSnapshot,
      })
      if (fresh.status === 'blocked') {
        setStatus({ phase: 'failed', message: fresh.message })
        toast.error(fresh.message)
        return
      }

      const describe = (txHash: string): SwapTx => ({
        txHash,
        direction,
        amount: fresh.amount,
        symbol: venue.assets[SWAP_DIRECTION[direction].from].symbol,
      })

      const outcome = await executeSwap({
        wallet: record,
        chainSlug: venue.chainSlug,
        request: fresh.request,
        onBroadcast: (txHash) => {
          if (live()) setStatus({ phase: 'pending', tx: describe(txHash) })
        },
      })
      if (!live()) return

      if (outcome.kind === 'unconfirmed') {
        setStatus({
          phase: 'unconfirmed',
          tx: describe(outcome.txHash),
          message: outcome.message,
        })
      } else {
        setStatus({ phase: outcome.kind, tx: describe(outcome.txHash) })
      }
    } catch (failure) {
      const message = failureMessage(failure)
      if (live()) setStatus({ phase: 'failed', message })
      toast.error(message)
    } finally {
      busyRef.current = false
      if (live()) refresh()
    }
  }

  async function recheck() {
    if (checkingRef.current || status.phase !== 'unconfirmed') return

    const tx = status.tx
    const epoch = epochRef.current
    const live = () => epoch === epochRef.current
    checkingRef.current = true
    setChecking(true)

    try {
      const receipt = await waitForReceipt(chainSlug, tx.txHash)
      if (!live()) return
      setStatus({ phase: receipt === 'success' ? 'confirmed' : 'reverted', tx })
    } catch (failure) {
      if (live()) {
        setStatus({ phase: 'unconfirmed', tx, message: failureMessage(failure) })
      }
    } finally {
      checkingRef.current = false
      if (live()) {
        setChecking(false)
        refresh()
      }
    }
  }

  const actionLabel = (() => {
    if (status.phase === 'submitting') {
      return direction === 'wrap' ? 'Wrapping...' : 'Unwrapping...'
    }
    if (status.phase === 'pending') return 'Confirming...'
    if (status.phase === 'unconfirmed') return 'Awaiting receipt'
    return fromAsset ? `${op.label} ${fromAsset.symbol}` : op.label
  })()

  return {
    groups,
    walletIds,
    setWalletIds: changeWallets,
    wallet,
    chainSlug,
    setChainSlug: changeChain,
    direction,
    setDirection: changeDirection,
    amount,
    setAmount: changeAmount,
    plan,
    max,
    canMax,
    canRefresh: wallet !== null && !locked && !reading,
    invalidAmount,
    reading,
    locked,
    status,
    checking,
    actionLabel,
    readError: snapshot?.error ?? null,
    fromSymbol: fromAsset?.symbol ?? '—',
    toSymbol: toAsset?.symbol ?? '—',
    fromBalance: snapshot ? balances[op.from] : null,
    toBalance: snapshot ? balances[op.to] : null,
    nativeSymbol: venue?.assets.native.symbol ?? '—',
    gasCost,
    submit,
    refresh,
    recheck,
    applyMax,
  }
}
