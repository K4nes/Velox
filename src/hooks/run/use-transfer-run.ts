import { useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { usePageStore } from '@/hooks/use-page-store'
import { useRun } from '@/hooks/run/use-run'
import type { RunState } from '@/hooks/run/use-run'
import type { PageStore } from '@/lib/core/page-store'
import { resolveEnsAddress } from '@/lib/chain/ens'
import { toMessage } from '@/lib/core/message'
import {
  runTransferPlan,
  spentUnits,
  summarizeTransferRun,
  tokenStates,
} from '@/lib/transfer/transfer-run'
import type {
  TransferRunProgress,
  TransferRunSummary,
  TransferStepState,
} from '@/lib/transfer/transfer-run'
import {
  buildTransferPlan,
  explainTransferBlockers,
  parseDestination,
} from '@/lib/transfer/transfer-plan'
import type {
  DestinationResolution,
  TransferSelection,
} from '@/lib/transfer/transfer-plan'
import { listWallets } from '@/lib/wallet/wallets'

const RESOLVE_DEBOUNCE_MS = 400

export type ResolvedDestination = {
  name: string
  address: `0x${string}` | null
  error: string | null
}

export type TransferRunFields = RunState<TransferRunProgress> & {
  destinationText: string
  resolved: ResolvedDestination | null
  history: Map<string, TransferStepState>
}

export function useTransferRun(input: {
  wallets: readonly { id: string; label: string; address: string }[]
  selections: readonly TransferSelection[]
  chain: string | null
  onSpent: (spent: Map<string, number>) => void
  onDeselect: (keys: string[]) => void
  store: PageStore<TransferRunFields>
}) {
  const store = input.store
  const { destinationText, resolved, history } = usePageStore(store)

  const parsed = useMemo(() => parseDestination(destinationText), [destinationText])

  useEffect(() => {
    if (parsed.kind !== 'ens') return

    const name = parsed.name
    let active = true
    const timer = window.setTimeout(() => {
      resolveEnsAddress(name)
        .then((address) => {
          if (!active) return
          store.set({ resolved: { name, address, error: null } })
        })
        .catch((failure: unknown) => {
          if (!active) return
          store.set({
            resolved: { name, address: null, error: toMessage(failure) },
          })
        })
    }, RESOLVE_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [parsed, store])

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

  const run = useRun<TransferRunProgress>({
    kind: 'transfer',
    store,
    clear: () => store.set({ history: new Map() }),
    // The table keeps the rows that already landed when a later run starts.
    onProgress: (next) => {
      const merged = new Map(store.get().history)
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
      if (changed) store.set({ history: merged })
    },
    onFinish: (progress) => {
      const result = summarizeTransferRun(progress)
      const spent = spentUnits(progress)
      input.onSpent(spent)
      input.onDeselect([...spent.keys()])

      const parts: string[] = []
      if (result.sent > 0) parts.push(`${result.sent} sent`)
      if (result.unknown > 0) parts.push(`${result.unknown} unconfirmed`)
      if (result.failed > 0) parts.push(`${result.failed} failed`)
      const line = parts.join(', ')

      if (result.failed > 0) {
        let firstError = ''
        for (const step of progress.steps) {
          if (step.status === 'failed') {
            firstError = step.error
            break
          }
        }
        toast.error(`${line} — ${firstError}`)
        return
      }

      if (result.unknown > 0) {
        toast.warning(`${line}, check the explorer`)
        return
      }

      if (result.sent > 0) toast.success(line)
    },
  })

  const steps = useMemo(() => {
    const merged = new Map(history)
    if (run.progress) {
      for (const [key, step] of tokenStates(run.progress)) merged.set(key, step)
    }
    return merged
  }, [history, run.progress])
  const summary: TransferRunSummary | null = run.progress
    ? summarizeTransferRun(run.progress)
    : null

  function changeDestination(text: string) {
    store.set({ destinationText: text })
  }

  function pickWallet(id: string) {
    const wallet = input.wallets.find((entry) => entry.id === id)
    if (wallet) store.set({ destinationText: wallet.address })
  }

  async function start() {
    const target = destination.status === 'ready' ? destination.destination : null
    const chain = input.chain
    const selections = input.selections

    if (target === null || chain === null || selections.length === 0) return

    await run.start(async ({ publish, shouldAbort, live }) => {
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

      // A run that stopped before the batch finished leaves no rows behind, so the table
      // shows only what the history already kept. A superseded run keeps its rows, because
      // a newer one may already be rendering them.
      if (outcome.error && live()) {
        const cleared = new Set(
          outcome.progress.steps.map((step) => step.tokenKey)
        )
        const next = new Map(store.get().history)
        for (const key of cleared) next.delete(key)
        store.set({ history: next })
        run.setProgress(null)
      }

      return outcome
    })
  }

  return {
    destinationText,
    changeDestination,
    pickWallet,
    pickerSelection,
    destination,
    blockedReason,
    start,
    reset: run.reset,
    running: run.running,
    error: run.error,
    summary,
    tokenStates: steps,
  }
}
