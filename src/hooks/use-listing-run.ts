import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/async'
import {
  buildListingPlan,
  estimateFeeTotals,
  explainPlanBlockers,
  groupListingItems,
  parsePrice,
} from '@/lib/listing-plan'
import type { ListingToken, PlanFeeTotals } from '@/lib/listing-plan'
import {
  listedKeys,
  runListingPlan,
  summarizeRun,
  tokenStates,
} from '@/lib/listing-run'
import type {
  ListingRunProgress,
  RunStepState,
  RunSummary,
} from '@/lib/listing-run'
import { requestListingActions } from '@/lib/opensea'
import type { CollectionInfo } from '@/lib/opensea'
import { WALLET_CONCURRENCY } from '@/lib/tx'
import {
  abortRunSlot,
  claimRunSlot,
  releaseRunSlot,
  runKindLabel,
} from '@/lib/run-slot'
import type { RunSlot } from '@/lib/run-slot'
import { listWallets } from '@/lib/wallets'

export function useListingRun(input: {
  selected: readonly ListingToken[]
  collection: CollectionInfo | null
  onListed?: (keys: string[]) => void
}) {
  const [price, setPrice] = useState('')
  const [durationDays, setDurationDays] = useState(30)
  const [progress, setProgress] = useState<ListingRunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
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

  const decimals = input.collection?.listingCurrency.decimals ?? 18
  const priceAmount = parsePrice(price, decimals)
  const chainSupported = input.collection
    ? chainBySlug(input.collection.chain) !== undefined
    : true
  const blockedReason = explainPlanBlockers({
    selected: input.selected,
    priceAmount,
    chainSupported,
  })

  const totalUnits = input.selected.reduce(
    (sum, token) => sum + token.quantity,
    0
  )
  const estimatedTotals: PlanFeeTotals = estimateFeeTotals({
    fees: input.collection?.fees ?? [],
    priceAmount: priceAmount ?? 0n,
    units: totalUnits,
  })

  const steps = useMemo(
    () => (progress ? tokenStates(progress) : new Map<string, RunStepState>()),
    [progress]
  )
  const summary: RunSummary | null = progress ? summarizeRun(progress) : null

  function reset() {
    setProgress(null)
    setError(null)
  }

  async function start() {
    if (runningRef.current) return

    const collection = input.collection
    if (!collection || input.selected.length === 0 || priceAmount === null) return

    const entry = chainBySlug(collection.chain)
    if (!entry) {
      setError('Chain not supported')
      toast.error('Chain not supported')
      return
    }

    // Captured before any wait so a start that outlives its page cannot install
    // a slot nobody can abort.
    const entryEpoch = epochRef.current

    // The form locks while waiting for an abandoned run to settle so what the
    // operator sees is what gets signed.
    runningRef.current = true
    setRunning(true)

    const claim = await claimRunSlot('listing', () => {
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
    const publish = (next: ListingRunProgress) => {
      if (live()) setProgress(next)
    }

    setError(null)
    setProgress(null)

    try {
      const records = await listWallets()
      const byAddress = new Map(
        records.map((record) => [record.address.toLowerCase(), record])
      )
      const batches = groupListingItems(input.selected)
      // The end time goes out with the request and comes back in the plan, so
      // both sides compare against this same instant.
      const endTimeSec =
        Math.floor(Date.now() / 1000) + durationDays * 24 * 60 * 60

      const envelopes = await mapLimit(
        batches,
        WALLET_CONCURRENCY,
        async (batch) => ({
          address: batch.address,
          label: byAddress.get(batch.address)?.label ?? batch.label,
          envelopes: await requestListingActions({
            address: batch.address,
            chain: collection.chain,
            priceAmount,
            currency: collection.listingCurrency.address,
            decimals,
            endTimeSec,
            items: batch.tokens.map((token) => ({
              contract: token.contract,
              tokenId: token.tokenId,
              quantity: token.quantity,
            })),
          }),
        })
      )

      if (!live()) return

      const plan = buildListingPlan({
        collection: {
          slug: collection.slug,
          name: collection.name,
          chain: collection.chain,
        },
        chainId: entry.chainId,
        tokens: input.selected,
        priceAmount,
        durationDays,
        endTimeSec,
        decimals,
        currency: collection.listingCurrency.address,
        envelopes,
      })

      const wallets = batches.flatMap((batch) => {
        const record = byAddress.get(batch.address)
        return record ? [record] : []
      })

      const outcome = await runListingPlan({
        plan,
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

      const keys = listedKeys(outcome.progress)
      if (keys.length > 0) input.onListed?.(keys)
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
      }
    }
  }

  return {
    price,
    setPrice,
    durationDays,
    setDuration: setDurationDays,
    running,
    progress,
    error,
    tokenStates: steps,
    summary,
    blockedReason,
    estimatedTotals,
    start,
    reset,
  }
}
