import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useRunGate } from '@/hooks/use-run-gate'
import { resolveEnsAddress } from '@/lib/ens'
import { runTransferPlan, spentUnits, summarizeTransferRun, tokenStates } from '@/lib/transfer-run'
import type {
  TransferRunProgress,
  TransferRunSummary,
  TransferStepState,
} from '@/lib/transfer-run'
import {
  buildTransferPlan,
  explainTransferBlockers,
  parseDestination,
} from '@/lib/transfer-plan'
import type {
  DestinationResolution,
  TransferSelection,
} from '@/lib/transfer-plan'
import { listWallets } from '@/lib/wallets'
import { redactUrls } from '@/lib/utils'

const RESOLVE_DEBOUNCE_MS = 400

export function useTransferRun(input: {
  wallets: readonly { id: string; label: string; address: string }[]
  selections: readonly TransferSelection[]
  chain: string | null
  onSpent: (spent: Map<string, number>) => void
  onDeselect: (keys: string[]) => void
}) {
  const gate = useRunGate('transfer')
  const { setError } = gate
  const [destinationText, setDestinationText] = useState('')
  const [resolved, setResolved] = useState<{
    name: string
    address: `0x${string}` | null
    error: string | null
  } | null>(null)
  const [progress, setProgress] = useState<TransferRunProgress | null>(null)
  const [history, setHistory] = useState<Map<string, TransferStepState>>(
    new Map()
  )

  const parsed = useMemo(() => parseDestination(destinationText), [destinationText])

  useEffect(() => {
    if (parsed.kind !== 'ens') return

    const name = parsed.name
    let active = true
    const timer = window.setTimeout(() => {
      resolveEnsAddress(name)
        .then((address) => {
          if (!active) return
          setResolved({ name, address, error: null })
        })
        .catch((failure: unknown) => {
          if (!active) return
          setResolved({
            name,
            address: null,
            error: redactUrls(
              failure instanceof Error ? failure.message : String(failure)
            ),
          })
        })
    }, RESOLVE_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [parsed])

  const destination = useMemo<DestinationResolution>(() => {
    if (parsed.kind === 'empty') return { status: 'empty' }
    if (parsed.kind === 'invalid') {
      return { status: 'invalid', message: parsed.message }
    }
    if (parsed.kind === 'address') {
      return {
        status: 'ready',
        destination: { address: parsed.address, ensName: null },
      }
    }

    const name = parsed.name
    if (!resolved || resolved.name !== name) return { status: 'checking', name }
    if (resolved.error !== null) {
      return { status: 'failed', name, message: resolved.error }
    }
    if (resolved.address === null) {
      return {
        status: 'failed',
        name,
        message: `${name} does not resolve to an address`,
      }
    }

    return {
      status: 'ready',
      destination: { address: resolved.address, ensName: name },
    }
  }, [parsed, resolved])

  const pickerSelection = useMemo(() => {
    if (destination.status !== 'ready') return []
    const target = destination.destination.address.toLowerCase()
    const match = input.wallets.find(
      (wallet) => wallet.address.toLowerCase() === target
    )
    return match ? [match.id] : []
  }, [destination, input.wallets])

  const blockedReason = explainTransferBlockers({
    selections: input.selections,
    destination,
    chain: input.chain,
  })

  const steps = useMemo(() => {
    const merged = new Map(history)
    if (progress) {
      for (const [key, step] of tokenStates(progress)) merged.set(key, step)
    }
    return merged
  }, [history, progress])
  const summary: TransferRunSummary | null = progress
    ? summarizeTransferRun(progress)
    : null

  function changeDestination(text: string) {
    setDestinationText(text)
  }

  function pickWallet(id: string) {
    const wallet = input.wallets.find((entry) => entry.id === id)
    if (wallet) setDestinationText(wallet.address)
  }

  function reset() {
    setProgress(null)
    setHistory(new Map())
    setError(null)
  }

  async function start() {
    const target = destination.status === 'ready' ? destination.destination : null
    const chain = input.chain
    const selections = input.selections

    if (target === null || chain === null || selections.length === 0) return

    const session = await gate.begin()
    if (!session) return

    const { live, shouldAbort } = session
    const publish = (next: TransferRunProgress) => {
      if (!live()) return
      setProgress(next)
      setHistory((previous) => {
        const merged = new Map(previous)
        let changed = false
        for (const step of next.steps) {
          if (
            step.status !== 'sent' &&
            step.status !== 'unknown' &&
            step.status !== 'failed'
          ) {
            continue
          }
          if (merged.get(step.tokenKey) !== step) {
            merged.set(step.tokenKey, step)
            changed = true
          }
        }
        return changed ? merged : previous
      })
    }
    setProgress(null)

    try {
      const plan = buildTransferPlan({
        chain,
        destination: target,
        selections,
      })
      const records = await listWallets()

      const outcome = await runTransferPlan({
        plan,
        wallets: records,
        onProgress: publish,
        shouldAbort,
      })

      if (!live()) return

      if (outcome.error) {
        const failedKeys = new Set(
          outcome.progress.steps.map((step) => step.tokenKey)
        )
        setHistory((previous) => {
          const next = new Map(previous)
          for (const key of failedKeys) next.delete(key)
          return next
        })
        setProgress(null)
        setError(outcome.error)
        toast.error(outcome.error)
        return
      }

      const result = summarizeTransferRun(outcome.progress)
      const spent = spentUnits(outcome.progress)
      input.onSpent(spent)
      input.onDeselect([...spent.keys()])

      const parts: string[] = []
      if (result.sent > 0) parts.push(`${result.sent} sent`)
      if (result.unknown > 0) parts.push(`${result.unknown} unconfirmed`)
      if (result.failed > 0) parts.push(`${result.failed} failed`)
      const summary = parts.join(', ')

      if (result.failed > 0) {
        let firstError = ''
        for (const step of outcome.progress.steps) {
          if (step.status === 'failed') {
            firstError = step.error
            break
          }
        }
        toast.error(`${summary} — ${firstError}`)
        return
      }

      if (result.unknown > 0) {
        toast.warning(`${summary}, check the explorer`)
        return
      }

      if (result.sent > 0) toast.success(summary)
    } catch (failure) {
      if (!live()) return
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
      toast.error(message)
    } finally {
      session.end()
    }
  }

  return {
    destinationText,
    changeDestination,
    pickWallet,
    pickerSelection,
    destination,
    blockedReason,
    start,
    reset,
    running: gate.running,
    error: gate.error,
    summary,
    tokenStates: steps,
  }
}
