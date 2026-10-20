import { useState } from 'react'
import { AlertTriangle, SlidersHorizontal } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { WalletSelect } from '@/components/wallet-select'
import { walletGroups } from '@/config/wallets'
import { cn } from '@/lib/utils'

const columns = ['Wallet Profile', 'Address', 'Quantity', 'Execution Status']

const mintStages = ['Public Stage', 'Allowlist Stage', 'Holder Stage']

const mintModes = [
  {
    id: 'normal',
    name: 'Normal',
    description: 'One plain transaction, sent when the stage opens.',
  },
  {
    id: 'fcfs',
    name: 'FCFS',
    description: 'Pre-fire your manual gas plan, then re-fire the moment it opens.',
  },
] as const

type MintMode = (typeof mintModes)[number]['id']

export function MintTasksPage() {
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [mintStage, setMintStage] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [mintMode, setMintMode] = useState<MintMode>('normal')
  const [advancedGas, setAdvancedGas] = useState(false)
  const [gasLimit, setGasLimit] = useState('')
  const [maxFee, setMaxFee] = useState('')
  const [priorityFee, setPriorityFee] = useState('')

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="grid flex-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-4 lg:grid-rows-[1fr_2fr]">
          <Card className="gap-0 py-0">
            <div className="flex items-center gap-2 p-4">
              <label htmlFor="collection-url" className="sr-only">
                Collection URL
              </label>
              <Input
                id="collection-url"
                placeholder="Collection URL"
                className="flex-1"
              />
              <Button className="shrink-0">Check</Button>
            </div>
            <h2 className="text-muted-foreground flex flex-1 items-center justify-center">
              No Collection URL Loaded
            </h2>
          </Card>
          <Card className="gap-0 overflow-hidden py-0">
            <div className="min-h-0 flex-1 [&>[data-slot=table-container]]:h-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column} className="h-11 px-4">
                        {column}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody />
              </Table>
            </div>
          </Card>
        </div>
        <Card className="gap-5 py-4">
          <h2 className="px-4 text-base font-semibold">Mint Configuration</h2>

          <div className="flex flex-col gap-2 px-4">
            <span className="text-sm font-medium">Wallets</span>
            <WalletSelect
              groups={walletGroups}
              selected={selectedWallets}
              onSelectedChange={setSelectedWallets}
              className="w-full justify-start"
            />
          </div>

          <div className="flex flex-col gap-2 px-4">
            <label htmlFor="mint-stage" className="text-sm font-medium">
              Mint Stage
            </label>
            <Select value={mintStage} onValueChange={setMintStage}>
              <SelectTrigger
                id="mint-stage"
                className="data-[size=default]:h-9 w-full justify-between rounded-lg px-3"
              >
                <SelectValue placeholder="Select Mint Stage" />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                {mintStages.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {stage}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 px-4">
            <label htmlFor="quantity" className="text-sm font-medium">
              Quantity
            </label>
            <Input
              id="quantity"
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>

          <Collapsible open={advancedGas} onOpenChange={setAdvancedGas} className="flex flex-col gap-2 px-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Mint Mode</span>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-primary gap-1.5 px-1.5">
                  <SlidersHorizontal className="size-4" />
                  {advancedGas ? 'Hide Advanced' : 'Advanced Gas'}
                </Button>
              </CollapsibleTrigger>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {mintModes.map((mode) => {
                const active = mintMode === mode.id
                return (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMintMode(mode.id)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                      active
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <span
                      className={cn(
                        'block text-sm font-medium',
                        active ? 'text-primary' : 'text-foreground'
                      )}
                    >
                      {mode.name}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                      {mode.description}
                    </span>
                  </button>
                )
              })}
            </div>
            <CollapsibleContent className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <label htmlFor="gas-limit" className="text-sm font-medium">
                    Gas Limit
                  </label>
                  <Input
                    id="gas-limit"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="250000"
                    value={gasLimit}
                    onChange={(event) => setGasLimit(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="max-fee" className="text-sm font-medium">
                    Max Fee (Gwei)
                  </label>
                  <Input
                    id="max-fee"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Auto"
                    value={maxFee}
                    onChange={(event) => setMaxFee(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="priority-fee" className="text-sm font-medium">
                  Priority Fee (Gwei)
                </label>
                <Input
                  id="priority-fee"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Auto"
                  value={priorityFee}
                  onChange={(event) => setPriorityFee(event.target.value)}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="mt-auto flex flex-col gap-3 px-4">
            <div className="bg-muted/40 rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center justify-between py-1">
                <span>Quantity</span>
                <span className="text-muted-foreground">—</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>NFT Price</span>
                <span className="text-muted-foreground">—</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t pt-2 font-semibold">
                <span>Cost</span>
                <span className="text-success">0 ETH</span>
              </div>
            </div>

            <Button size="lg" className="w-full" disabled>
              Start Mint
            </Button>

            <div className="border-warning/30 bg-warning/10 text-warning flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Specify collection URL</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
