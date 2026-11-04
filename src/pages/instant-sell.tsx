import { useMemo } from 'react'
import { Scan } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { WalletSelect } from '@/components/wallet-select'
import { chainBySlug } from '@/config/chains'
import { useBulkSellScan } from '@/hooks/use-bulk-sell-scan'
import { useCollectionOffers } from '@/hooks/use-collection-offers'
import { useInstantSellRun } from '@/hooks/use-instant-sell-run'
import { useWalletGroups } from '@/hooks/use-wallets'
import { planSales } from '@/lib/instant-sell'
import type { SellStepState } from '@/lib/sell-run'
import { sellStepsByToken } from '@/lib/sell-run'
import { Inventory } from '@/pages/instant-sell/inventory'
import type { InventoryRow } from '@/pages/instant-sell/inventory'
import { SellRail } from '@/pages/instant-sell/sell-rail'

const NO_STEPS = new Map<string, SellStepState>()

export function InstantSellPage() {
  const scan = useBulkSellScan()
  const offers = useCollectionOffers(scan.collection)
  const run = useInstantSellRun({
    onSold: scan.deselect,
    onSettled: offers.refresh,
  })
  const { groups } = useWalletGroups()

  const plan = useMemo(
    () =>
      planSales({
        selected: scan.selection,
        ladder: offers.ladder,
        nowSec: Math.floor(Date.now() / 1000),
      }),
    [scan.selection, offers.ladder]
  )

  const statuses = useMemo(
    () => (run.progress ? sellStepsByToken(run.progress) : NO_STEPS),
    [run.progress]
  )

  const selectedSet = useMemo(
    () => new Set(scan.selectedKeys),
    [scan.selectedKeys]
  )

  const offersState = offers.state

  const rows = useMemo(() => {
    const best = offers.ladder?.offers[0] ?? null

    return scan.rows.map((token): InventoryRow => {
      const selected = selectedSet.has(token.key)
      const assigned = plan.assigned.get(token.key) ?? null
      const sold = statuses.get(token.key)?.status === 'sold'
      let blocked: InventoryRow['blocked'] = null

      if (sold) {
        blocked = 'sold'
      } else if (Math.floor(token.quantity) < 1) {
        blocked = 'sub-unit'
      } else if (selected) {
        blocked = plan.uncovered.get(token.key) ?? null
      } else if (!offers.ladder) {
        blocked =
          offersState.status === 'loading'
            ? 'loading'
            : offersState.status === 'failed'
              ? 'unavailable'
              : 'no-bid'
      } else if (offers.ladder.remainingUnits < 1) {
        blocked = 'depth-exhausted'
      }

      return {
        token,
        best,
        assigned,
        blocked,
        selected,
        status: statuses.get(token.key),
      }
    })
  }, [scan.rows, selectedSet, plan, statuses, offers.ladder, offersState.status])

  const visibleSelectable = rows.filter(
    (row) =>
      Math.floor(row.token.quantity) >= 1 &&
      row.blocked !== 'sold' &&
      (row.selected || row.blocked === null)
  )
  const allVisibleSelected =
    visibleSelectable.length > 0 &&
    visibleSelectable.every((row) => row.selected)
  const someVisibleSelected =
    !allVisibleSelected && visibleSelectable.some((row) => row.selected)

  function toggleVisible() {
    if (visibleSelectable.length === 0) return

    const keys = new Set(visibleSelectable.map((row) => row.token.key))
    const everySelected = visibleSelectable.every((row) => row.selected)
    scan.selectKeys(
      everySelected
        ? scan.selectedKeys.filter((key) => !keys.has(key))
        : [...new Set([...scan.selectedKeys, ...keys])]
    )
  }

  const chainSupported = scan.collection
    ? chainBySlug(scan.collection.chain) !== undefined
    : true

  const blockedReason = !scan.collection
    ? 'Scan a collection to load bids'
    : !chainSupported
      ? 'Chain not supported'
      : offersState.status === 'loading' && offersState.book === null
        ? 'Loading offers…'
        : offersState.status === 'failed' && offersState.book === null
          ? 'Offers could not be loaded — refresh'
          : !offers.ladder
            ? 'No active collection offers'
            : scan.selection.length === 0
              ? 'Select at least one token'
              : plan.targets.length === 0
                ? 'None of the selected tokens has a bid'
                : null

  function check() {
    run.reset()
    void scan.scan()
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="gap-3 p-4 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="collection-url" className="text-xs font-medium">
            Collection URL or slug (OpenSea / Scatter)
          </label>
          <Input
            id="collection-url"
            value={scan.url}
            onChange={(event) => scan.changeUrl(event.target.value)}
            placeholder="https://opensea.io/collection/… or https://scatter.art/…"
            disabled={scan.running || run.running}
          />
        </div>

        <div
          className="flex flex-col gap-1.5 lg:w-[280px]"
          role="group"
          aria-labelledby="instant-wallet-label"
        >
          <span id="instant-wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={groups}
            selected={scan.selectedWallets}
            onSelectedChange={scan.changeWallets}
            disabled={scan.running || run.running}
            aria-labelledby="instant-wallet-label"
            className="w-full"
          />
        </div>

        <Button
          className="shrink-0"
          onClick={check}
          disabled={!scan.canScan || run.running}
        >
          {scan.running ? <Spinner data-icon="inline-start" /> : <Scan />}
          Scan held NFTs
        </Button>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Inventory
          state={scan.state}
          rows={rows}
          totalRows={scan.totalRows}
          query={scan.query}
          onQueryChange={scan.setQuery}
          allVisibleSelected={allVisibleSelected}
          someVisibleSelected={someVisibleSelected}
          onToggleVisible={toggleVisible}
          running={run.running}
          onToggleToken={scan.toggleToken}
          currencySymbol={
            plan.currency?.symbol ?? offers.ladder?.currency.symbol ?? 'ETH'
          }
        />

        <SellRail
          offers={offersState}
          ladders={offers.ladders}
          ladder={offers.ladder}
          currency={offers.currency}
          onCurrencyChange={offers.setCurrency}
          onRefresh={offers.refresh}
          plan={plan}
          selectedCount={scan.selection.length}
          summary={run.summary}
          error={run.error}
          blockedReason={blockedReason}
          running={run.running}
          onAccept={() => void run.start(plan.targets)}
        />
      </div>
    </div>
  )
}
