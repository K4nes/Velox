import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TaskList, type TaskListItem, type TaskStatus } from './task-list'
import { WalletSelect } from '@/components/wallet-select'
import { walletGroups } from '@/config/wallets'
import { cn } from '@/lib/utils'

const columns = ['Wallet Profile', 'Address', 'Quantity', 'Execution Status']

const mintStages = ['Public Stage', 'Allowlist Stage', 'Holder Stage']

const mintModes = [
  { id: 'normal', name: 'Normal' },
  { id: 'fcfs', name: 'FCFS' },
] as const

type MintMode = (typeof mintModes)[number]['id']

type Task = {
  id: string
  name: string
  url: string
  wallets: string[]
  mintStage: string
  quantity: string
  mintMode: MintMode
  advancedGas: boolean
  gasLimit: string
  maxFee: string
  priorityFee: string
  status: TaskStatus
  checked: boolean
}

type TaskPatch = Partial<Omit<Task, 'id'>>

const CHECK_DURATION = 1200

const PLACEHOLDER_ID = 'placeholder'

const placeholderTask: Task = {
  id: PLACEHOLDER_ID,
  name: 'Task',
  url: '',
  wallets: [],
  mintStage: '',
  quantity: '1',
  mintMode: 'normal',
  advancedGas: false,
  gasLimit: '',
  maxFee: '',
  priorityFee: '',
  status: 'idle',
  checked: false,
}

function uid() {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // randomUUID throws on non-secure origins; fall through to the counter.
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function slugFromUrl(raw: string) {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    const segments = url.pathname.split('/').filter(Boolean)
    const marker = segments.findIndex((part) => {
      const segment = part.toLowerCase()
      return segment === 'collection' || segment === 'marketplace'
    })
    if (marker !== -1 && !segments[marker + 1]) return null
    const candidate = marker !== -1 ? segments[marker + 1] : segments.at(-1)
    if (!candidate) return null
    const slug = candidate.toLowerCase()
    if (/^\d+$/.test(slug) || /^0x[0-9a-f]+$/.test(slug)) return null
    return slug
  } catch {
    return null
  }
}

function createTask(): Task {
  return {
    id: uid(),
    name: 'Task',
    url: '',
    wallets: [],
    mintStage: '',
    quantity: '1',
    mintMode: 'normal',
    advancedGas: false,
    gasLimit: '',
    maxFee: '',
    priorityFee: '',
    status: 'idle',
    checked: false,
  }
}

export function MintTasksPage() {
  const [tasks, setTasks] = useState<Task[]>(() => [createTask()])
  const [activeId, setActiveId] = useState<string | null>(null)
  const runsRef = useRef(new Map<string, number>())
  const timersRef = useRef(new Map<string, number>())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const realActive = tasks.find((task) => task.id === activeId) ?? tasks[0] ?? null
  const active = realActive ?? placeholderTask
  const isPlaceholder = realActive === null
  const locked = isPlaceholder
  const hasUrl = active.url.trim().length > 0
  const canPickWallets = !locked && active.checked

  const items: TaskListItem[] = useMemo(
    () =>
      tasks.map((task) => ({
        id: task.id,
        label: task.name,
        status: task.status,
      })),
    [tasks]
  )

  function updateTask(id: string, patch: TaskPatch) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task))
    )
  }

  function updateActive(patch: TaskPatch) {
    if (!realActive) return
    updateTask(realActive.id, patch)
  }

  function cancelRun(id: string) {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    runsRef.current.set(id, (runsRef.current.get(id) ?? 0) + 1)
  }

  function addTask() {
    const task = createTask()
    setTasks((current) => [...current, task])
    setActiveId(task.id)
  }

  function closeTask(id: string) {
    const index = tasks.findIndex((task) => task.id === id)
    if (index === -1) return

    cancelRun(id)
    runsRef.current.delete(id)
    const remaining = tasks.filter((task) => task.id !== id)

    setTasks(remaining)
    if (realActive?.id === id) {
      const neighbour = remaining[index] ?? remaining[index - 1] ?? null
      setActiveId(neighbour ? neighbour.id : null)
    }
  }

  function changeUrl(url: string) {
    if (!realActive) return
    cancelRun(realActive.id)
    updateTask(realActive.id, { name: 'Task', url, status: 'idle', checked: false })
  }

  function setWallets(ids: string[]) {
    updateActive({ wallets: ids })
  }

  function check() {
    if (!realActive || realActive.status === 'running' || !hasUrl) return

    const id = realActive.id
    const url = realActive.url
    cancelRun(id)
    const run = runsRef.current.get(id) ?? 0
    updateTask(id, { status: 'running', checked: false })

    const timer = window.setTimeout(() => {
      timersRef.current.delete(id)
      if (runsRef.current.get(id) !== run) return
      const slug = slugFromUrl(url)
      updateTask(
        id,
        slug
          ? { name: slug, status: 'idle', checked: true }
          : { name: 'Task', status: 'failed', checked: false }
      )
    }, CHECK_DURATION)
    timersRef.current.set(id, timer)
  }

  const headline = !hasUrl
    ? 'No Collection URL Loaded'
    : active.status === 'running'
      ? 'Checking…'
      : active.status === 'failed'
        ? 'Check failed — collection URL not recognised'
        : active.checked
          ? 'Last check complete'
          : 'Ready to check'

  return (
    <div className="flex min-h-[calc(100svh-3rem)] flex-col p-6 lg:h-[calc(100svh-3rem)] lg:min-h-0 lg:overflow-hidden">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[160px_minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[200px_minmax(0,1fr)_300px]">
        <TaskList
          items={items}
          activeId={realActive?.id ?? null}
          onSelect={setActiveId}
          onClose={closeTask}
          onAdd={addTask}
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
                  disabled={locked}
                  value={active.url}
                  onChange={(event) => changeUrl(event.target.value)}
                />
              </div>
              <Button
                className="shrink-0"
                onClick={check}
                disabled={locked || !hasUrl || active.status === 'running'}
              >
                Check
              </Button>
            </div>
            <p role="status" className="sr-only">
              {headline}
            </p>
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <div className="min-h-0 flex-1 [&>[data-slot=table-container]]:h-full">
              <Table>
                <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead
                        key={column}
                        className="text-muted-foreground px-3 py-2 text-xs leading-tight font-medium whitespace-normal"
                      >
                        {column}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={columns.length}
                      className="text-muted-foreground h-24 text-center"
                    >
                      No data yet
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        <Card className="min-h-0 gap-0 py-0 @container">
          <h2 className="flex h-12 shrink-0 items-center border-b px-4 text-[13px] font-semibold">Mint Configuration</h2>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">Wallets</span>
              <WalletSelect
                groups={walletGroups}
                selected={active.wallets}
                onSelectedChange={setWallets}
                disabled={!canPickWallets}
                className="w-full justify-start [&>span]:truncate"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="mint-stage" className="text-xs font-medium">
                Mint Stage
              </label>
              <Select
                value={active.mintStage}
                onValueChange={(value) => updateActive({ mintStage: value })}
              >
                <SelectTrigger
                  id="mint-stage"
                  disabled={locked}
                  className="w-full justify-between rounded-lg px-3"
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

            <div className="flex flex-col gap-2">
              <label htmlFor="quantity" className="text-xs font-medium">
                Quantity
              </label>
              <Input
                id="quantity"
                type="number"
                min={1}
                step={1}
                disabled={locked}
                value={active.quantity}
                onChange={(event) => updateActive({ quantity: event.target.value })}
              />
            </div>

            <Collapsible
              open={active.advancedGas}
              onOpenChange={(open) => updateActive({ advancedGas: open })}
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
                      disabled={locked}
                      onClick={() => updateActive({ mintMode: mode.id })}
                      className={cn(
                        'h-9 rounded-lg border text-sm font-medium transition-colors',
                        'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
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
                      disabled={locked}
                      value={active.gasLimit}
                      onChange={(event) => updateActive({ gasLimit: event.target.value })}
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
                      disabled={locked}
                      value={active.maxFee}
                      onChange={(event) => updateActive({ maxFee: event.target.value })}
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
                      disabled={locked}
                      value={active.priorityFee}
                      onChange={(event) => updateActive({ priorityFee: event.target.value })}
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

            <Button className="h-10 w-full" disabled>
              Start Mint
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
