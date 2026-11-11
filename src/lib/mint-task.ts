import { formatEther } from 'viem'
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

export type WalletRun = {
  walletId: string
  label: string
  address: string
  caps: Record<string, number>
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

// The quantity ceiling is OpenSea's number, never a constant here. Two server
// fields carry it: `max_per_wallet` on the stage, which exists before the stage
// opens, and `max_total_mintable_by_wallet` from the eligibility check, which is
// the tighter of the two once the stage is live. Zero means the server has not
// answered yet, so the input carries no max at all.
export function quantityCeiling(walletMax: number, stage: DropStage | null): number {
  const perWallet = Number.parseInt(stage?.maxPerWallet ?? '', 10)
  const bounds = [walletMax, perWallet].filter(
    (value) => Number.isFinite(value) && value > 0
  )
  return bounds.length > 0 ? Math.min(...bounds) : 0
}

export function initialQuantity(walletMax: number, stage: DropStage | null): string {
  return walletMax >= 1
    ? String(Math.min(walletMax, quantityCeiling(walletMax, stage)))
    : '1'
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

export function ethLabel(wei: bigint): string {
  const value = Number(formatEther(wei))
  return value === 0 ? '0 ETH' : `${value.toFixed(4)} ETH`
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
    const caps: Record<string, number> = {}
    for (const entry of row.stages) {
      const max = Number.parseInt(entry.maxMintable, 10)
      caps[entry.stageUuid] = Number.isFinite(max) && max > 0 ? max : 0
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
          : (caps[stageUuid] ?? 0) > 0
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
    .map((row) => row.caps[stageUuid] ?? 0)
  return caps.length > 0 ? Math.min(...caps) : 0
}

export function mintableRow(row: WalletRun, stageUuid: string): boolean {
  if (row.checkFailed) return false
  // A mint on another stage says nothing about this one: each stage carries its
  // own cap, so only a landing on this exact stage retires the wallet.
  if (row.mintedStages.includes(stageUuid)) return false
  return (row.caps[stageUuid] ?? 0) >= 1
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
      : (run.caps[stageUuid] ?? 0) > 0
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
  mintQuantity: number
  quantityReady: boolean
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
  const mintQuantity = Number.parseInt(task.quantity, 10)
  const quantityReady = Number.isInteger(mintQuantity) && mintQuantity >= 1
  const isMintingThisTask = input.runningIds.includes(task.id)

  const canStartMint =
    !locked &&
    task.checked &&
    task.drop !== null &&
    selectedStage !== null &&
    task.arm === null &&
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
    mintQuantity,
    quantityReady,
    canStartMint,
    mintStage,
    stagePriceWei,
    totalWei,
  }
}
