import { useMemo } from 'react'
import { toast } from 'sonner'
import { chainBySlug } from '@/config/chains'
import { mapLimit } from '@/lib/core/async'
import { WALLET_CONCURRENCY } from '@/lib/core/concurrency'
import { usePageStore } from '@/hooks/use-page-store'
import { useRun } from '@/hooks/run/use-run'
import type { RunState } from '@/hooks/run/use-run'
import type { PageStore } from '@/lib/core/page-store'
import { addressKey } from '@/lib/wallet/address'
import {
  buildListingPlan,
  estimateFeeTotals,
  explainPlanBlockers,
  groupListingItems,
  parsePrice,
} from '@/lib/listings/listing-plan'
import type { ListingToken, PlanFeeTotals } from '@/lib/listings/listing-plan'
import {
  listedKeys,
  runListingPlan,
  summarizeRun,
  tokenStates,
} from '@/lib/listings/listing-run'
import type {
  ListingRunProgress,
  RunStepState,
  RunSummary,
} from '@/lib/listings/listing-run'
import { requestListingActions } from '@/lib/opensea/index'
import type { CollectionInfo } from '@/lib/opensea/index'
import { listWallets } from '@/lib/wallet/wallets'

export type ListingRunFields = RunState<ListingRunProgress> & {
  price: string
  durationDays: number
}

export function useListingRun(input: {
  selected: readonly ListingToken[]
  collection: CollectionInfo | null
  onListed?: (keys: string[]) => void
  store: PageStore<ListingRunFields>
}) {
  const { price, durationDays } = usePageStore(input.store)

  const run = useRun<ListingRunProgress>({
    kind: 'listing',
    store: input.store,
    onFinish: (progress) => {
      const keys = listedKeys(progress)
      if (keys.length > 0) input.onListed?.(keys)
    },
  })

  function setPrice(next: string) {
    input.store.set({ price: next })
  }

  function setDuration(next: number) {
    input.store.set({ durationDays: next })
  }

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
    () =>
      run.progress
        ? tokenStates(run.progress)
        : new Map<string, RunStepState>(),
    [run.progress]
  )
  const summary: RunSummary | null = run.progress
    ? summarizeRun(run.progress)
    : null

  async function start() {
    const collection = input.collection
    if (!collection || input.selected.length === 0 || priceAmount === null) return

    const entry = chainBySlug(collection.chain)
    if (!entry) {
      run.setError('Chain not supported')
      toast.error('Chain not supported')
      return
    }

    // The form locks while waiting for an abandoned run to settle so what the
    // operator sees is what gets signed.
    await run.start(async ({ publish, shouldAbort }) => {
      const records = await listWallets()
      const byAddress = new Map(
        records.map((record) => [addressKey(record.address), record])
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

      return runListingPlan({
        plan,
        wallets,
        onProgress: publish,
        shouldAbort,
      })
    })
  }

  return {
    price,
    setPrice,
    durationDays,
    setDuration,
    running: run.running,
    progress: run.progress,
    error: run.error,
    tokenStates: steps,
    summary,
    blockedReason,
    estimatedTotals,
    start,
    reset: run.reset,
  }
}
