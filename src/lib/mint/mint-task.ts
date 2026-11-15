import { formatUnits } from 'viem'
import type { EligibilityRow } from '@/lib/opensea/eligibility'
import type { DropInfo, DropStage } from '@/lib/opensea/index'

export const MINT_COLUMNS = ['Wallet Profile', 'Address', 'Quantity', 'Execution Status']

export const mintModes = [
  { id: 'normal', name: 'Normal' },
  { id: 'fcfs', name: 'FCFS' },
] as const

export type MintMode = (typeof mintModes)[number]['id']

export type TaskStatus = 'idle' | 'running' | 'failed'

export type TaskListItem = {
  id: string
  label: string
  status: TaskStatus
}

export type RunStatus =
  | 'eligible'
  | 'ineligible'
  | 'scheduled'
  | 'queued'
  | 'minting'
  | 'broadcast'
  | 'confirmed'
  | 'failed'
  // The provider refused something the operator must fix in the task, such as a list
  // priced in an ERC-20. Distinct from `failed`, which is a request that errored.
  | 'blocked'

export type WalletRun = {
  walletId: string
  label: string
  address: string
  // A number is the provider's cap; `null` is a stage the provider states no cap
  // for, which is still eligible; an absent entry is a stage the check did not report.
  caps: Record<string, number | null>
  status: RunStatus
  txHash?: string
  // The chain the hash was broadcast on. A re-check can drop the detected drop, so
  // the explorer link must not depend on what the task holds right now.
  chain?: string
  error?: string
  checkFailed?: boolean
  // Every stage this wallet broadcast on, oldest first. One landing slot cannot
  // say "already minted A" once the wallet is tried on B.
  mintedStages: string[]
}

// What a check produces. An armed run mints straight from this instead of the
// state update, which has not committed when the countdown reaches zero.
export type CheckResult = {
  drop: DropInfo
  rows: WalletRun[]
  quantityMax: number
}

export const RUN_LABEL: Record<RunStatus, string> = {
  eligible: 'Eligible',
  ineligible: 'Not eligible',
  scheduled: 'Scheduled',
  queued: 'Queued',
  minting: 'Minting',
  broadcast: 'Broadcast',
  confirmed: 'Confirmed',
  failed: 'Failed',
  blocked: 'Blocked',
}

export const RUN_TONE: Record<RunStatus, string> = {
  eligible: 'text-success',
  ineligible: 'text-muted-foreground',
  scheduled: 'text-muted-foreground',
  queued: 'text-muted-foreground',
  minting: 'text-warning',
  broadcast: 'text-muted-foreground',
  confirmed: 'text-success',
  failed: 'text-destructive',
  blocked: 'text-warning',
}

export type Task = {
  id: string
  name: string
  url: string
  wallets: string[]
  drop: DropInfo | null
  quantity: string
  quantityMax: number
  stageUuid: string
  mintMode: MintMode
  advancedGas: boolean
  gasLimit: string
  maxFee: string
  priorityFee: string
  status: TaskStatus
  checked: boolean
  // A stage that has not opened yet is armed, not minted: the countdown runs on
  // block time and fires the check plus the mint at zero.
  arm: { stageUuid: string; startMs: number } | null
}

export type TaskPatch = Partial<Omit<Task, 'id'>>

const PLACEHOLDER_ID = 'placeholder'

export function landed(row: WalletRun): boolean {
  return (
    row.mintedStages.length > 0 &&
    (row.status === 'confirmed' || row.status === 'broadcast')
  )
}

export function reachedChain(row: WalletRun): boolean {
  return row.mintedStages.length > 0
}

// The provider's own number is the cap. Absence, as `''`, NaN or zero, is no cap at
// all, so a real provider limit is never mistaken for a sentinel.
function statedCap(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

// A stage the provider states no cap for is still eligible. An absent entry does not
// describe the stage, and zero means the check found the wallet outside the list.
function capEligible(cap: number | null | undefined): boolean {
  return cap === null || (cap ?? 0) >= 1
}

// The quantity ceiling is the provider's number, never a constant here. Two server
// fields carry it: the stage's per-wallet cap, which exists before the stage opens,
// and the cap from the eligibility check, which is the tighter of the two once the
// stage is live. Zero means no stated ceiling, so the input carries no max at all.
export function quantityCeiling(walletMax: number, stage: DropStage | null): number {
  const perWallet = Number.parseInt(stage?.maxPerWallet ?? '', 10)
  const bounds = [walletMax, perWallet].map(statedCap).filter((value) => value > 0)
  return bounds.length > 0 ? Math.min(...bounds) : 0
}

export function initialQuantity(walletMax: number, stage: DropStage | null): string {
  // Zero means the check found no cap; the stage's own number still bounds the input,
  // and the old prefill of 1 stands when neither does.
  if (!(walletMax >= 1)) return '1'
  const ceiling = quantityCeiling(walletMax, stage)
  return ceiling > 0 ? String(ceiling) : '1'
}

export const placeholderTask: Task = {
  id: PLACEHOLDER_ID,
  name: 'Task',
  url: '',
  wallets: [],
  drop: null,
  quantity: '1',
  quantityMax: 0,
  stageUuid: '',
  mintMode: 'normal',
  advancedGas: false,
  gasLimit: '',
  maxFee: '',
  priorityFee: '',
  status: 'idle',
  checked: false,
  arm: null,
}

function uid() {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // randomUUID throws on non-secure origins; fall through to the counter.
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function gweiToWei(gwei: string): bigint | undefined {
  const value = Number.parseFloat(gwei)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return BigInt(Math.round(value * 1e9))
}

export function weiFromDecimal(value: string): bigint | null {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

// The amount is carried in base units. A provider that states a currency says how to
// read it; without one the stage keeps the 18-decimal ETH reading it always had.
export function amountLabel(wei: bigint, stage: DropStage | null): string {
  const decimals = stage?.currency?.decimals ?? 18
  const symbol = stage?.currency?.symbol ?? 'ETH'
  if (wei === 0n) return `0 ${symbol}`
  const value = Number(formatUnits(wei, decimals))
  // A nonzero amount below the printed precision must not claim the mint is free.
  if (value === 0) return `<0.0001 ${symbol}`
  return `${value.toFixed(4)} ${symbol}`
}

export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`
}

export function createTask(): Task {
  return {
    id: uid(),
    name: 'Task',
    url: '',
    wallets: [],
    drop: null,
    quantity: '1',
    quantityMax: 0,
    stageUuid: '',
    mintMode: 'normal',
    advancedGas: false,
    gasLimit: '',
    maxFee: '',
    priorityFee: '',
    status: 'idle',
    checked: false,
    arm: null,
  }
}

export function rowsFromCheck(rows: EligibilityRow[], stageUuid: string): WalletRun[] {
  return rows.map((row) => {
    const caps: Record<string, number | null> = {}
    for (const entry of row.stages) {
      const max = Number.parseInt(entry.maxMintable, 10)
      // An empty string is the provider saying it states no cap. A parsed number is
      // the cap itself, and a zero or unreadable one means the wallet is outside the
      // list. The two absences must not collapse into the same value.
      caps[entry.stageUuid] =
        entry.maxMintable === ''
          ? null
          : Number.isFinite(max) && max > 0
            ? max
            : 0
    }
    return {
      walletId: row.walletId,
      label: row.label,
      address: row.address,
      caps,
      status: row.error
        ? 'failed'
        : stageUuid === ''
          ? 'scheduled'
          : capEligible(caps[stageUuid])
            ? 'eligible'
            : 'ineligible',
      error: row.error,
      checkFailed: Boolean(row.error),
      mintedStages: [],
    }
  })
}

// One address can be stored in two folders as two records, and the check keeps
// only one of them. Keying by address keeps a landing attached to whichever
// record the check produced, so the batch cannot hold the same address twice and
// mint it twice.
export function mergeCheckedRows(
  checkedRows: WalletRun[],
  priorRows: WalletRun[]
): WalletRun[] {
  const prior = new Map(priorRows.map((row) => [row.address.toLowerCase(), row]))
  const checkedAddresses = new Set(
    checkedRows.map((row) => row.address.toLowerCase())
  )

  return [
    ...checkedRows.map((row) => {
      const previous = prior.get(row.address.toLowerCase())
      if (previous && previous.mintedStages.length > 0) {
        return {
          ...row,
          mintedStages: previous.mintedStages,
          ...(landed(previous)
            ? {
                status: previous.status,
                txHash: previous.txHash,
                chain: previous.chain,
              }
            : {}),
        }
      }
      return row
    }),
    ...priorRows.filter(
      (row) =>
        row.mintedStages.length > 0 &&
        !checkedAddresses.has(row.address.toLowerCase())
    ),
  ]
}

// A row can outlive its wallet leaving the task, so the ceiling comes from the
// wallets that would actually mint, or a stale cap blocks the start.
export function quantityMaxFor(
  rows: WalletRun[],
  wallets: string[],
  stageUuid: string
): number {
  const caps = rows
    .filter((row) => wallets.includes(row.walletId) && mintableRow(row, stageUuid))
    .map((row) => row.caps[stageUuid])
  // One wallet with no stated cap leaves nothing to enforce, and zero is how the
  // ceiling carries "no ceiling". It cannot be the minimum of a mix with real caps.
  if (caps.includes(null)) return 0
  const numbers = caps.filter((cap): cap is number => typeof cap === 'number')
  return numbers.length > 0 ? Math.min(...numbers) : 0
}

export function mintableRow(row: WalletRun, stageUuid: string): boolean {
  if (row.checkFailed) return false
  // A blocked row's fix is in the task, not in the wallet. It must never reach a
  // batch, and a stale rows map must not leak one in.
  if (row.status === 'blocked') return false
  // A mint on another stage says nothing about this one: each stage carries its
  // own cap, so only a landing on this exact stage retires the wallet.
  if (row.mintedStages.includes(stageUuid)) return false
  return capEligible(row.caps[stageUuid])
}

// A row's check status follows the selected stage; a mint status only speaks for
// the stage it landed on.
export function stageStatusFor(
  run: WalletRun,
  stageUuid: string,
  stageNotOpen: boolean
): RunStatus {
  const verdict = (): RunStatus =>
    run.mintedStages.includes(stageUuid)
      ? 'failed'
      : capEligible(run.caps[stageUuid])
        ? 'eligible'
        : stageNotOpen
          ? 'scheduled'
          : 'ineligible'

  if (run.status !== 'eligible' && run.status !== 'ineligible') {
    if (landed(run) && stageUuid !== '' && run.mintedStages.at(-1) !== stageUuid) {
      return verdict()
    }
    return run.status
  }
  return verdict()
}

// This issue loads Scatter lists but does not build Scatter mints. The refusal names
// the missing step instead of leaving a disabled button without a reason.
export const SCATTER_MINT_REFUSAL =
  'Scatter minting is not available yet. This build can load Scatter lists but cannot build a Scatter mint transaction.'

// A task that cannot start says why: a provider that cannot build its mint, or a
// wallet the provider blocked, whose fix is in the task rather than in the wallet.
export function startRefusalFor(task: Task, rows: WalletRun[]): string | null {
  if (task.drop?.source === 'scatter') return SCATTER_MINT_REFUSAL

  const blocked = rows.filter(
    (row) => task.wallets.includes(row.walletId) && row.status === 'blocked'
  )
  if (blocked.length === 0) return null
  return `${blocked.length} selected wallet${blocked.length === 1 ? ' is' : 's are'} blocked. Clear the block before starting.`
}

export type TaskView = {
  activeRuns: WalletRun[]
  stageItems: DropStage[]
  selectedStage: DropStage | null
  isLiveStage: boolean
  stageStartMs: number
  stageEndMs: number
  blockNow: number
  stageNotOpen: boolean
  stageClosed: boolean
  mintWalletCount: number
  readyWalletCount: number
  quantityLimit: number
  quantityHint: string | null
  mintQuantity: number
  quantityReady: boolean
  startRefusal: string | null
  canStartMint: boolean
  mintStage: DropStage | null
  stagePriceWei: bigint | null
  totalWei: bigint | null
}

export function taskView(input: {
  task: Task
  rows: WalletRun[]
  runningIds: string[]
  knownWalletIds: Set<string>
  locked: boolean
  nowMs: number
  blockSample: { ms: number; at: number } | null
}): TaskView {
  const { task, knownWalletIds, locked, nowMs, blockSample } = input

  const activeRuns = input.rows.filter((row) =>
    task.wallets.includes(row.walletId)
  )
  // A stage that has not opened yet is armed and counted down to, not refused.
  const stageItems = task.drop?.stages ?? []
  const selectedStage =
    task.drop?.stages.find((stage) => stage.uuid === task.stageUuid) ?? null
  const isLiveStage =
    selectedStage !== null && selectedStage.uuid === task.drop?.activeStage?.uuid
  const stageStartMs = selectedStage?.startTime
    ? Date.parse(selectedStage.startTime)
    : NaN
  const stageEndMs = selectedStage?.endTime ? Date.parse(selectedStage.endTime) : NaN
  const blockNow = blockSample ? blockSample.ms + (nowMs - blockSample.at) : nowMs
  // A stage that has not opened reports no cap, so a zero cap alone cannot tell
  // "not eligible" apart from "not open yet". The schedule can.
  const stageNotOpen = Number.isFinite(stageStartMs) && stageStartMs > blockNow
  const stageClosed = Number.isFinite(stageEndMs) && stageEndMs <= blockNow

  const mintWalletCount = task.wallets.filter((walletId) => {
    if (!knownWalletIds.has(walletId)) return false
    const run = activeRuns.find((row) => row.walletId === walletId)
    return run ? mintableRow(run, task.stageUuid) : false
  }).length
  const readyWalletCount = task.wallets.filter((walletId) => {
    if (!knownWalletIds.has(walletId)) return false
    const run = activeRuns.find((row) => row.walletId === walletId)
    return run ? !run.checkFailed : false
  }).length

  const quantityLimit = selectedStage
    ? quantityCeiling(task.quantityMax, selectedStage)
    : 0
  const quantityHint =
    selectedStage === null
      ? null
      : task.drop?.source === 'scatter' && selectedStage.maxPerWallet === ''
        ? 'No stated cap'
        : quantityLimit > 0
          ? `Max ${quantityLimit} per wallet`
          : null
  const mintQuantity = Number.parseInt(task.quantity, 10)
  const quantityReady = Number.isInteger(mintQuantity) && mintQuantity >= 1
  const isMintingThisTask = input.runningIds.includes(task.id)

  const startRefusal = startRefusalFor(task, activeRuns)
  const canStartMint =
    !locked &&
    task.checked &&
    task.drop !== null &&
    selectedStage !== null &&
    task.arm === null &&
    startRefusal === null &&
    !stageClosed &&
    (isLiveStage || Number.isFinite(stageStartMs)) &&
    quantityReady &&
    (quantityLimit === 0 || mintQuantity <= quantityLimit) &&
    (isLiveStage ? mintWalletCount > 0 : readyWalletCount > 0) &&
    !isMintingThisTask

  const mintStage =
    selectedStage ?? task.drop?.activeStage ?? task.drop?.nextStage ?? null
  const stagePriceWei = mintStage ? weiFromDecimal(mintStage.priceWei) : null
  const totalWei =
    stagePriceWei !== null && quantityReady && mintWalletCount > 0
      ? stagePriceWei * BigInt(mintQuantity) * BigInt(mintWalletCount)
      : null

  return {
    activeRuns,
    stageItems,
    selectedStage,
    isLiveStage,
    stageStartMs,
    stageEndMs,
    blockNow,
    stageNotOpen,
    stageClosed,
    mintWalletCount,
    readyWalletCount,
    quantityLimit,
    quantityHint,
    mintQuantity,
    quantityReady,
    startRefusal,
    canStartMint,
    mintStage,
    stagePriceWei,
    totalWei,
  }
}
