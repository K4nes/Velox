import { useEffect, useRef } from 'react'
import { Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/empty-state'
import {
  EligibilityResultSummary,
  EligibilityResultTable,
} from './eligibility-result-table'
import { SnapshotCard, SnapshotDetail } from './snapshot-card'
import { WalletSelect } from '@/components/wallet-select'
import { useEligibilityCheck } from '@/hooks/scan/use-eligibility-check'
import { mintEligibilityStore } from '@/pages/mint/store'
import { useSnapshotLibrary } from '@/hooks/data/use-snapshot-library'
import { useWalletGroups } from '@/hooks/data/use-wallets'

export function MintEligibilityPage() {
  const library = useSnapshotLibrary()
  const check = useEligibilityCheck(
    mintEligibilityStore,
    library.clearSaveError
  )
  const { groups, error: walletsError } = useWalletGroups()
  const selectedSnapshot = library.selectedSnapshot
  const gridRef = useRef<HTMLDivElement>(null)
  const restoreFocusId = useRef<string | null>(null)

  useEffect(() => {
    const id = restoreFocusId.current
    if (selectedSnapshot || !id) return
    restoreFocusId.current = null
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-snapshot-id="${id}"]`)
      ?.focus()
  }, [selectedSnapshot])

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Tabs defaultValue="check" className="flex flex-1 flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="check" className="focus-visible:ring-[1px]">
            Check Eligible
          </TabsTrigger>
          <TabsTrigger value="snapshot" className="focus-visible:ring-[1px]">
            Snapshot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="flex flex-1 flex-col gap-4">
          <Card className="gap-3 p-4 lg:flex-row lg:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label
                htmlFor="eligibility-collection-url"
                className="text-xs font-medium"
              >
                Collection URL or slug (OpenSea / Scatter)
              </label>
              <Input
                id="eligibility-collection-url"
                placeholder="https://opensea.io/collection/… or https://scatter.art/…"
                disabled={check.running}
                value={check.url}
                onChange={(event) => check.changeUrl(event.target.value)}
              />
            </div>
            <div
              className="flex flex-col gap-1.5 lg:w-[280px]"
              role="group"
              aria-labelledby="eligibility-wallet-label"
            >
              <span id="eligibility-wallet-label" className="text-xs font-medium">
                Wallet
              </span>
              <WalletSelect
                groups={groups}
                selected={check.selectedWallets}
                onSelectedChange={check.changeWallets}
                disabled={check.running}
                aria-labelledby="eligibility-wallet-label"
                className="w-full"
              />
              {walletsError ? (
                <p role="alert" className="text-destructive text-xs">
                  Wallet list unavailable. {walletsError}
                </p>
              ) : null}
            </div>
            <Button
              className="shrink-0"
              onClick={() => void check.check()}
              disabled={
                check.running ||
                check.selectedWallets.length === 0 ||
                !check.url.trim()
              }
            >
              {check.running ? <Spinner data-icon="inline-start" /> : null}
              Check
            </Button>
          </Card>
          <Card className="flex flex-1 flex-col gap-0 overflow-hidden py-0">
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
              <div className="flex min-w-0 items-center gap-2">
                {check.checked ? (
                  <EligibilityResultSummary
                    name={check.checked.drop.name}
                    imageUrl={check.checked.imageUrl}
                    marketplace={check.checked.marketplace}
                    chain={check.checked.chainName}
                  />
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {library.saveError ? (
                  <span className="text-destructive text-xs">
                    {library.saveError}
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (check.checked) void library.save(check.checked)
                  }}
                  disabled={!check.checked || library.saving}
                >
                  {library.saving ? 'Saving…' : 'Save snapshot'}
                </Button>
              </div>
            </div>
            <EligibilityResultTable
              state={check.tableState}
              stageColumns={check.checked?.stageColumns ?? []}
            />
          </Card>
        </TabsContent>

        <TabsContent value="snapshot" className="flex flex-1 flex-col gap-4">
          {library.loading ? (
            <p className="text-muted-foreground text-xs">Loading snapshots…</p>
          ) : library.snapshotsError ? (
            <p className="text-destructive text-xs">{library.snapshotsError}</p>
          ) : (
            <>
              {library.deleteError ? (
                <p className="text-destructive text-xs">{library.deleteError}</p>
              ) : null}
              {library.snapshots.length === 0 ? (
                <EmptyState
                  icon={Bookmark}
                  title="No snapshots yet"
                  description="Run a check, then save it from the Check Eligible tab."
                />
              ) : selectedSnapshot ? (
                <SnapshotDetail
                  snapshot={selectedSnapshot}
                  onBack={() => {
                    restoreFocusId.current = selectedSnapshot.id
                    library.setSelectedSnapshotId(null)
                  }}
                  onRefresh={() => void library.refresh(selectedSnapshot)}
                  refreshing={library.refreshingId === selectedSnapshot.id}
                  busy={library.refreshingId !== null}
                  refreshError={
                    library.refreshError?.id === selectedSnapshot.id
                      ? library.refreshError.message
                      : null
                  }
                />
              ) : (
                <div
                  ref={gridRef}
                  className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                >
                  {library.snapshots.map((snapshot) => (
                    <SnapshotCard
                      key={snapshot.id}
                      snapshot={snapshot}
                      busy={library.deletingId !== null}
                      deleting={library.deletingId === snapshot.id}
                      onView={library.setSelectedSnapshotId}
                      onDelete={(id) => void library.remove(id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
