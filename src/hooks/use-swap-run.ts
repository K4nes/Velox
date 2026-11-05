import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  abortRunSlot,
  claimRunSlot,
  releaseRunSlot,
  runKindLabel,
} from '@/lib/run-slot'
import type { RunSlot } from '@/lib/run-slot'
import type { SwapBatch } from '@/lib/swap-batch'
import { specKey } from '@/lib/swap-spec'
import { runSwapPlan, summarizeSwapRun, walletStates } from '@/lib/swap-run'
import type {
  SwapRunProgress,
  SwapRunSummary,
  SwapWalletState,
} from '@/lib/swap-run'
import { listWallets } from '@/lib/wallets'

export function useSwapRun(input: {
  batch: SwapBatch | null
  onSettled?: () => void
}): {
  running: boolean
  error: string | null
  summary: SwapRunSummary | null
  states: Map<string, SwapWalletState>
  start: () => Promise<void>
} {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<SwapRunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runningRef = useRef(false)
  const epochRef = useRef(0)
  const slotRef = useRef<RunSlot | null>(null)

  useEffect(() => {
    const epoch = epochRef.current
    return () => {
      if (epochRef.current === epoch) epochRef.current += 1
      if (slotRef.current) abortRunSlot(slotRef.current)
    }
  }, [])

  // Progress describes the batch it ran against. Editing the trade or the
  // selection invalidates it, so the rows never show another trade's outcome.
  const batchKey = input.batch
    ? specKey(
        input.batch.spec,
        input.batch.jobs.map((job) => job.walletId)
      )
    : null

  useEffect(() => {
    setProgress(null)
    setError(null)
  }, [batchKey])

  const summary = useMemo(
    () => (progress ? summarizeSwapRun(progress) : null),
    [progress]
  )
  const states = useMemo(() => walletStates(progress), [progress])

  async function start() {
    const batch = input.batch
    if (runningRef.current || batch === null || batch.jobs.length === 0) return

    // Captured before any wait so a start that outlives its page cannot install
    // a slot nobody can abort.
    const entryEpoch = epochRef.current

    runningRef.current = true
    setRunning(true)

    const claim = await claimRunSlot('swap', () => {
      if (entryEpoch === epochRef.current) {
        setError('Waiting for the previous run to finish')
      }
    })

    if (claim.kind === 'busy') {
      runningRef.current = false
      if (entryEpoch === epochRef.current) {
        const message = runKindLabel(claim.running)
        setRunning(false)
        setError(message)
        toast.error(message)
      }
      return
    }

    if (entryEpoch !== epochRef.current) {
      releaseRunSlot(claim.slot)
      runningRef.current = false
      return
    }

    const slot = claim.slot
    slotRef.current = slot
    const epoch = epochRef.current
    const live = () => epoch === epochRef.current
    const publish = (next: SwapRunProgress) => {
      if (live()) setProgress(next)
    }

    setError(null)
    setProgress(null)

    try {
      const wallets = await listWallets()
      const outcome = await runSwapPlan({
        batch,
        wallets,
        onProgress: publish,
        shouldAbort: () => slot.aborted,
      })

      if (!live()) return

      if (outcome.error) {
        setError(outcome.error)
        toast.error(outcome.error)
        return
      }

      const result = summarizeSwapRun(outcome.progress)
      const parts: string[] = []
      if (result.done > 0) parts.push(`${result.done} done`)
      if (result.refunded > 0) parts.push(`${result.refunded} refunded`)
      if (result.failed > 0) parts.push(`${result.failed} failed`)
      if (result.unconfirmed > 0) {
        parts.push(`${result.unconfirmed} unconfirmed`)
      }
      if (result.active > 0) parts.push(`${result.active} still processing`)
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
      const message = parts.join(', ')

      if (message === '') return
      if (result.failed > 0) {
        toast.error(message)
      } else if (
        result.done > 0 &&
        result.unconfirmed === 0 &&
        result.refunded === 0 &&
        result.active === 0
      ) {
        toast.success(message)
      } else {
        toast.warning(message)
      }
    } catch (failure) {
      if (!live()) return
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
      toast.error(message)
    } finally {
      releaseRunSlot(slot)
      if (slotRef.current === slot) slotRef.current = null
      if (live()) {
        runningRef.current = false
        setRunning(false)
        input.onSettled?.()
      }
    }
  }

  return { running, error, summary, states, start }
}
