import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/async'
import {
  buildListingPlan,
  estimateFeeTotals,
  explainPlanBlockers,
  groupListingItems,
  parsePriceEth,
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
import { listWallets } from '@/lib/wallets'

const WALLET_CONCURRENCY = 2

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

  const priceWei = parsePriceEth(price)
  const chainSupported = input.collection
    ? chainBySlug(input.collection.chain) !== undefined
    : true
  const blockedReason = explainPlanBlockers({
    selected: input.selected,
    priceWei,
    chainSupported,
  })

  const totalUnits = input.selected.reduce(
    (sum, token) => sum + token.quantity,
    0
  )
  const estimatedTotals: PlanFeeTotals = estimateFeeTotals({
    fees: input.collection?.fees ?? [],
    priceWei: priceWei ?? 0n,
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
    if (!collection || input.selected.length === 0 || priceWei === null) return

    const entry = chainBySlug(collection.chain)
    if (!entry) {
      setError('Chain not supported')
      toast.error('Chain not supported')
      return
    }

    runningRef.current = true
    setRunning(true)
    setError(null)
    setProgress(null)

    try {
      const records = await listWallets()
      const byAddress = new Map(
        records.map((record) => [record.address.toLowerCase(), record])
      )
      const batches = groupListingItems(input.selected)
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
            priceWei,
            currency: collection.listingCurrency.address,
            endTimeSec,
            items: batch.tokens.map((token) => ({
              contract: token.contract,
              tokenId: token.tokenId,
              quantity: token.quantity,
            })),
          }),
        })
      )

      const plan = buildListingPlan({
        collection: {
          slug: collection.slug,
          name: collection.name,
          chain: collection.chain,
        },
        chainId: entry.chainId,
        tokens: input.selected,
        priceWei,
        durationDays,
        envelopes,
      })

      const wallets = batches.flatMap((batch) => {
        const record = byAddress.get(batch.address)
        return record ? [record] : []
      })

      const outcome = await runListingPlan({
        plan,
        wallets,
        onProgress: setProgress,
      })

      if (outcome.error) {
        setError(outcome.error)
        toast.error(outcome.error)
        return
      }

      const keys = listedKeys(outcome.progress)
      if (keys.length > 0) input.onListed?.(keys)
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message)
      toast.error(message)
    } finally {
      runningRef.current = false
      setRunning(false)
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
