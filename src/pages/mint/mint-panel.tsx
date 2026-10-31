import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { WalletSelect } from '@/components/wallet-select'
import type { WalletGroup } from '@/components/wallet-select'
import {
  countdownLabel,
  ethLabel,
  mintModes,
} from '@/lib/mint-task'
import type { Task, TaskPatch, TaskView } from '@/lib/mint-task'
import { cn } from '@/lib/utils'

type MintPanelProps = {
  active: Task
  view: TaskView
  groups: WalletGroup[]
  walletsError: string | null
  canPickWallets: boolean
  locked: boolean
  isMinting: boolean
  onWallets: (ids: string[]) => void
  onStage: (uuid: string) => void
  onPatch: (patch: TaskPatch) => void
  onStart: () => void
  onArm: () => void
  onDisarm: () => void
}

export function MintPanel({
  active,
  view,
  groups,
  walletsError,
  canPickWallets,
  locked,
  isMinting,
  onWallets,
  onStage,
  onPatch,
  onStart,
  onArm,
  onDisarm,
}: MintPanelProps) {
  const {
    stageItems,
    selectedStage,
    isLiveStage,
    blockNow,
    quantityLimit,
    mintQuantity,
    quantityReady,
    canStartMint,
    stagePriceWei,
    totalWei,
  } = view

  return (
    <Card className="min-h-0 gap-0 py-0 @container">
      <h2 className="flex h-12 shrink-0 items-center border-b px-4 text-[13px] font-semibold">Mint Configuration</h2>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Wallets</span>
          <WalletSelect
            groups={groups}
            selected={active.wallets}
            onSelectedChange={onWallets}
            disabled={!canPickWallets}
            className="w-full justify-start [&>span]:truncate"
          />
          {walletsError ? (
            <p role="alert" className="text-destructive text-xs">
              Wallet list unavailable. {walletsError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="mint-stage" className="text-xs font-medium">
            Mint Stage
          </label>
          <Select
            value={selectedStage?.uuid ?? ''}
            onValueChange={onStage}
            disabled={stageItems.length === 0 || isMinting}
          >
            <SelectTrigger id="mint-stage" className="w-full">
              <SelectValue
                placeholder={
                  !active.drop
                    ? 'Check a collection first'
                    : stageItems.length === 0
                      ? 'No stage scheduled'
                      : 'Select a stage'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {stageItems.map((stage) => (
                <SelectItem key={stage.uuid} value={stage.uuid}>
                  {stage.label || '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="quantity" className="text-xs font-medium">
            Quantity
          </label>
          <Input
            id="quantity"
            type="number"
            min={1}
            max={quantityLimit || undefined}
            step={1}
            disabled={locked || !active.checked || isMinting}
            value={active.quantity}
            onChange={(event) => onPatch({ quantity: event.target.value })}
          />
          {quantityLimit > 0 ? (
            <p className="text-muted-foreground text-[11px]">
              Max {quantityLimit} per wallet
            </p>
          ) : null}
        </div>

        <Collapsible
          open={active.advancedGas}
          onOpenChange={(open) => onPatch({ advancedGas: open })}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">Mint Mode</span>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                className="text-primary gap-1.5 px-1.5"
              >
                <SlidersHorizontal className="size-4" />
                {active.advancedGas ? 'Hide Advanced' : 'Advanced Gas'}
              </Button>
            </CollapsibleTrigger>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {mintModes.map((mode) => {
              const selectedMode = active.mintMode === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={selectedMode}
                  disabled={locked || mode.id === 'fcfs'}
                  title={mode.id === 'fcfs' ? 'Not available yet' : undefined}
                  onClick={() => onPatch({ mintMode: mode.id })}
                  className={cn(
                    'h-9 rounded-lg border text-sm font-medium transition-colors',
                    'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                    'disabled:pointer-events-none disabled:opacity-50',
                    selectedMode
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border text-foreground hover:bg-muted/50'
                  )}
                >
                  {mode.name}
                </button>
              )
            })}
          </div>
          <CollapsibleContent className="flex flex-col gap-3 [mask-image:none]! [-webkit-mask-image:none]!">
            <div className="grid grid-cols-2 gap-2 @[20rem]:grid-cols-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="gas-limit" className="text-xs font-medium">
                  Gas Limit
                </label>
                <Input
                  id="gas-limit"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="250000"
                  disabled={locked || isMinting}
                  value={active.gasLimit}
                  onChange={(event) => onPatch({ gasLimit: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="max-fee" className="text-xs font-medium">
                  Max Fee (Gwei)
                </label>
                <Input
                  id="max-fee"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Auto"
                  disabled={locked || isMinting}
                  value={active.maxFee}
                  onChange={(event) => onPatch({ maxFee: event.target.value })}
                />
              </div>
              <div className="col-span-2 flex flex-col gap-2 @[20rem]:col-span-1">
                <label htmlFor="priority-fee" className="text-xs font-medium">
                  Priority Fee (Gwei)
                </label>
                <Input
                  id="priority-fee"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Auto"
                  disabled={locked || isMinting}
                  value={active.priorityFee}
                  onChange={(event) => onPatch({ priorityFee: event.target.value })}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t p-4">
        <div className="bg-muted rounded-lg border px-3 py-2 text-sm">
          <div className="flex items-center justify-between py-1">
            <span>Quantity</span>
            <span className="text-muted-foreground tabular-nums">
              {quantityReady ? mintQuantity : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span>NFT Price</span>
            <span className="text-muted-foreground tabular-nums">
              {stagePriceWei !== null ? ethLabel(stagePriceWei) : '—'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t pt-2 font-semibold">
            <span>Cost</span>
            <span className="text-success tabular-nums">
              {totalWei !== null ? ethLabel(totalWei) : '0 ETH'}
            </span>
          </div>
        </div>

        {active.arm ? (
          <div className="flex flex-col gap-2">
            <div className="bg-muted flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Mint opens in</span>
              <span className="font-semibold tabular-nums">
                {countdownLabel(active.arm.startMs - blockNow)}
              </span>
            </div>
            <Button
              className="h-10 w-full"
              variant="outline"
              onClick={onDisarm}
              disabled={isMinting}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            className="h-10 w-full"
            onClick={() => (isLiveStage ? onStart() : onArm())}
            disabled={!canStartMint}
          >
            {isMinting ? 'Minting…' : 'Start Mint'}
          </Button>
        )}
      </div>
    </Card>
  )
}
