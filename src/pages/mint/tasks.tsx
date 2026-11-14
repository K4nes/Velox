import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useMintTasks } from '@/hooks/run/use-mint-tasks'
import { mintTasksStore } from '@/pages/mint/store'
import { MintPanel } from './mint-panel'
import { RunTable } from './run-table'
import { TaskList } from './task-list'

export function MintTasksPage() {
  const mint = useMintTasks(mintTasksStore)
  const { active, view } = mint
  const isMintingThisTask = mint.runningIds.includes(active.id)

  return (
    <div className="flex min-h-[calc(100svh-3rem)] flex-col p-6 lg:h-[calc(100svh-3rem)] lg:min-h-0 lg:overflow-hidden">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[160px_minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[200px_minmax(0,1fr)_300px]">
        <TaskList
          items={mint.items}
          activeId={mint.activeId}
          busyIds={mint.runningIds}
          onSelect={mint.setActiveId}
          onClose={mint.closeTask}
          onAdd={mint.addTask}
        />

        <div className="grid min-h-0 gap-3 lg:grid-rows-[auto_minmax(0,1fr)]">
          <Card className="gap-0 py-0">
            <h2 className="sr-only">Collection</h2>
            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="collection-url" className="text-xs font-medium">
                  Collection URL or slug (OpenSea / Scatter)
                </label>
                <Input
                  id="collection-url"
                  placeholder="https://opensea.io/collection/… or https://scatter.art/…"
                  disabled={mint.locked || isMintingThisTask}
                  value={active.url}
                  onChange={(event) => mint.changeUrl(event.target.value)}
                />
              </div>
              <Button
                className="shrink-0"
                onClick={() => void mint.check()}
                disabled={
                  mint.locked ||
                  !mint.hasUrl ||
                  active.wallets.length === 0 ||
                  active.status === 'running' ||
                  isMintingThisTask
                }
              >
                {active.status === 'running' ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Check
              </Button>
            </div>
          </Card>

          <RunTable
            runs={view.activeRuns}
            stageUuid={active.stageUuid}
            statusOf={mint.stageStatus}
          />
        </div>

        <MintPanel
          active={active}
          view={view}
          groups={mint.groups}
          walletsError={mint.walletsError}
          canPickWallets={mint.canPickWallets}
          locked={mint.locked}
          isMinting={isMintingThisTask}
          onWallets={mint.setWallets}
          onStage={mint.selectStage}
          onPatch={mint.updateActive}
          onStart={() => void mint.startMint()}
          onArm={mint.armStage}
          onDisarm={mint.disarmStage}
        />
      </div>
    </div>
  )
}
