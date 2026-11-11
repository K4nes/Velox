import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/core/async'
import { toMessage } from '@/lib/core/error-message'
import { useRunGate } from '@/hooks/use-run-gate'
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
import { WALLET_CONCURRENCY } from '@/lib/chain/tx'
import { listWallets } from '@/lib/wallets'

export function useListingRun(input: {
  selected: readonly ListingToken[]
  collection: CollectionInfo | null
  onListed?: (keys: string[]) => void
}) {
  const gate = useRunGate('listing')
  const { setError } = gate
  const [price, setPrice] = useState('')
  const [durationDays, setDurationDays] = useState(30)
  const [progress, setProgress] = useState<ListingRunProgress | null>(null)

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
    const collection = input.collection
    if (!collection || input.selected.length === 0 || priceAmount === null) return

    const entry = chainBySlug(collection.chain)
    if (!entry) {
      setError('Chain not supported')
      toast.error('Chain not supported')
      return
    }

    // The form locks while waiting for an abandoned run to settle so what the
    // operator sees is what gets signed.
    const session = await gate.begin()
    if (!session) return

    const { live, shouldAbort } = session
    const publish = (next: ListingRunProgress) => {
      if (live()) setProgress(next)
    }

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
        shouldAbort,
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
      const message = toMessage(failure)
      setError(message)
      toast.error(message)
    } finally {
      session.end()
    }
  }

  return {
    price,
    setPrice,
    durationDays,
    setDuration: setDurationDays,
    running: gate.running,
    progress,
    error: gate.error,
    tokenStates: steps,
    summary,
    blockedReason,
    estimatedTotals,
    start,
    reset,
  }
}
