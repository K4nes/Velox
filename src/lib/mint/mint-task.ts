import type { EligibilityRow } from '@/lib/opensea/eligibility'
import type { MintAllowance } from '@/lib/mint/allowance'
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
  // The provider refused something the operator must fix in the task, such as a missing
  // token ID. Distinct from `failed`, which is a request that errored.
  | 'blocked'
  // The wallet holds the token but has not granted the spender enough allowance. The
  // fix is an approval, not a task change, so it is distinct from `blocked`.
  | 'needs-approval'

// A build the check asked the provider for before the run. The verdict belongs to one
// list, so a stage change cannot reuse it.
export type ProbeStatus =
  | 'eligible'
  | 'needs-approval'
  | 'blocked'
  | 'failed'

export type MintProbe = {
  stageUuid: string
  status: ProbeStatus
  error?: string
  // The allowance the build named, so the Cost panel can price the task in the token
  // rather than the stage's native currency.
  allowances: MintAllowance[]
}

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
  // The stage the current status and error were taken against. A run status on one
  // list must not speak for another.
  statusStage: string
  // The pre-run build verdict for the list it was taken against.
  probe: MintProbe | null
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
  'needs-approval': 'Needs approval',
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
  'needs-approval': 'text-warning',
}

export type Task = {
  id: string
  name: string
  url: string
  // The Scatter edition this task mints. Empty for an ERC-721 and for OpenSea.
  tokenId: string
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
  // A stage-change probe is in flight; Start and arming wait for its verdict.
  probing?: boolean
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
  tokenId: '',
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
    tokenId: '',
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
      statusStage: stageUuid,
      probe: null,
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
                statusStage: previous.statusStage,
                checkFailed: false,
                error: previous.error,
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

type StageWindow = {
  open: boolean
  notOpen: boolean
  closed: boolean
  startMs: number
  endMs: number
}

function stageWindow(stage: DropStage | null, nowMs: number): StageWindow {
  if (!stage) {
    return { open: false, notOpen: false, closed: false, startMs: NaN, endMs: NaN }
  }
  const startMs = stage.startTime ? Date.parse(stage.startTime) : NaN
  const endMs = stage.endTime ? Date.parse(stage.endTime) : NaN
  const notOpen = Number.isFinite(startMs) && startMs > nowMs
  const closed = Number.isFinite(endMs) && endMs <= nowMs
  return { open: !notOpen && !closed, notOpen, closed, startMs, endMs }
}

export function stageLiveAt(stage: DropStage | null, nowMs: number): boolean {
  return stageWindow(stage, nowMs).open
}

// The countdown and the stage probe must age one block sample the same way.
export function blockTimeAt(
  sample: { ms: number; at: number } | null,
  nowMs: number
): number {
  return sample ? sample.ms + (nowMs - sample.at) : nowMs
}

export function probeFor(row: WalletRun, stageUuid: string): MintProbe | null {
  return row.probe?.stageUuid === stageUuid ? row.probe : null
}

// The reason a provider block carries when its own wording is absent.
const BLOCKED_DEFAULT =
  'The provider blocked this wallet on the selected list.'

// The reason the row's visible status carries. A run or probe on another list does
// not speak for this one.
export function reasonFor(row: WalletRun, stageUuid: string): string | null {
  const probe = probeFor(row, stageUuid)
  const checkFailedRow = row.checkFailed && row.statusStage === stageUuid
  if (runOnStage(row, stageUuid) && !checkFailedRow) {
    return row.error ?? (row.status === 'blocked' ? BLOCKED_DEFAULT : null)
  }
  if (
    probe?.status === 'needs-approval' ||
    probe?.status === 'blocked' ||
    probe?.status === 'failed'
  ) {
    return probe.error ?? (probe.status === 'blocked' ? BLOCKED_DEFAULT : null)
  }
  if (checkFailedRow) {
    return probe?.status === 'eligible' ? null : (row.error ?? null)
  }
  return null
}

// The fix a blocked row carries, or null when the row is not blocked on this list.
// A probe verdict belongs to its own stage, so an old list's block cannot leak.
export function blockedReason(row: WalletRun, stageUuid: string): string | null {
  const reason = reasonFor(row, stageUuid)
  if (reason === null) return null
  const checkFailedRow = row.checkFailed && row.statusStage === stageUuid
  if (runOnStage(row, stageUuid) && !checkFailedRow) {
    return row.status === 'blocked' ? reason : null
  }
  const probe = probeFor(row, stageUuid)
  return probe?.status === 'blocked' ? reason : null
}

export function applyProbeVerdicts(
  rows: WalletRun[],
  stageUuid: string,
  verdicts: ReadonlyMap<
    string,
    { status: ProbeStatus; error?: string; allowances?: MintAllowance[] }
  >
): WalletRun[] {
  return rows.map((row) => {
    const verdict = verdicts.get(row.walletId)
    const top = row.caps[stageUuid]
    const caps =
      verdict?.status === 'eligible' && (top === undefined || top === 0)
        ? { ...row.caps, [stageUuid]: null }
        : row.caps
    return {
      ...row,
      caps,
      probe: verdict
        ? { stageUuid, ...verdict, allowances: verdict.allowances ?? [] }
        : null,
    }
  })
}

// A verdict belongs to the list it was taken against. Changing the stage drops it and
// leaves any block a run already reached untouched.
export function clearProbeVerdicts(rows: WalletRun[]): WalletRun[] {
  return rows.map((row) => (row.probe === null ? row : { ...row, probe: null }))
}

function checkedStatusFor(row: WalletRun, stageUuid: string): RunStatus {
  if (row.checkFailed && row.statusStage === stageUuid) return 'failed'
  if (stageUuid === '') return 'scheduled'
  return capEligible(row.caps[stageUuid]) ? 'eligible' : 'ineligible'
}

export function mintableRow(row: WalletRun, stageUuid: string): boolean {
  const probe = probeFor(row, stageUuid)
  const checkFailedRow = row.checkFailed && row.statusStage === stageUuid
  if (checkFailedRow && probe?.status !== 'eligible') return false

  // A block a run already reached is newer than the probe and must keep the row
  // out of the next batch. A block on another list does not.
  if (row.status === 'blocked' && runOnStage(row, stageUuid)) return false
  // A block's fix is in the task, not in the wallet. It must never reach a batch,
  // and a stale rows map must not leak one in. A failed probe may be transient, so
  // the run's own build is allowed to answer it again.
  if (probe?.status === 'blocked' || probe?.status === 'needs-approval') {
    return false
  }
  // A successful build is the strongest answer: a failed list read or a stale cap
  // cannot hide it. A landing on this exact stage still retires the wallet.
  if (probe?.status === 'eligible') {
    return !row.mintedStages.includes(stageUuid)
  }
  // A mint on another stage says nothing about this one: each stage carries its
  // own cap, so only a landing on this exact stage retires the wallet.
  if (row.mintedStages.includes(stageUuid)) return false
  return capEligible(row.caps[stageUuid])
}

// Which run statuses describe what a wallet already did, rather than what a check
// predicted. The switch is exhaustive so a new status cannot fall through silently.
function runOwnsRow(status: RunStatus): boolean {
  switch (status) {
    case 'queued':
    case 'minting':
    case 'broadcast':
    case 'confirmed':
    case 'failed':
    case 'blocked':
      return true
    case 'eligible':
    case 'ineligible':
    case 'scheduled':
    case 'needs-approval':
      return false
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

function runOnStage(row: WalletRun, stageUuid: string): boolean {
  return runOwnsRow(row.status) && row.statusStage === stageUuid
}

// A row's check status follows the selected stage; a mint status only speaks for
// the stage it landed on.
export function stageStatusFor(
  run: WalletRun,
  stageUuid: string,
  stageNotOpen: boolean
): RunStatus {
  const probe = probeFor(run, stageUuid)
  const checkFailedRow = run.checkFailed && run.statusStage === stageUuid
  const verdict = (): RunStatus =>
    run.mintedStages.includes(stageUuid)
      ? 'failed'
      : stageNotOpen
        ? 'scheduled'
        : checkedStatusFor(run, stageUuid)

  // A run status describes what this wallet already did on the stage, so it wins
  // over the free build's earlier answer. A list read that failed is not a run.
  if (runOnStage(run, stageUuid) && !checkFailedRow) return run.status

  if (
    probe?.status === 'needs-approval' ||
    probe?.status === 'blocked' ||
    probe?.status === 'failed'
  ) {
    return probe.status
  }
  if (probe?.status === 'eligible') {
    return run.mintedStages.includes(stageUuid) ? 'failed' : 'eligible'
  }
  if (checkFailedRow) return 'failed'
  if (run.status === 'scheduled') return 'scheduled'
  return verdict()
}

// A task that cannot start counts the selected rows whose verdict is a fix outside the
// batch: a provider block, or an allowance the wallet has not granted. The reason for
// one row is in its execution log.
export function startRefusalFor(
  task: Task,
  rows: WalletRun[]
): string | null {
  const statuses = rows
    .filter((row) => task.wallets.includes(row.walletId))
    .map((row) => stageStatusFor(row, task.stageUuid, false))
  const blocked = statuses.filter((status) => status === 'blocked').length
  const needsApproval = statuses.filter(
    (status) => status === 'needs-approval'
  ).length
  if (blocked === 0 && needsApproval === 0) return null

  const parts: string[] = []
  if (blocked > 0) {
    parts.push(
      `${blocked} selected wallet${blocked === 1 ? ' is' : 's are'} blocked`
    )
  }
  if (needsApproval > 0) {
    parts.push(
      `${needsApproval} selected wallet${needsApproval === 1 ? ' needs' : 's need'} approval`
    )
  }
  const hint =
    needsApproval > 0
      ? 'Open the row log for the token and amount.'
      : 'Open the row log for the reason.'
  return `${parts.join('; ')}. ${hint}`
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
  canStartMint: boolean
  mintStage: DropStage | null
  stagePriceWei: bigint | null
  // The token the selected list charges, taken from the first selected row's build.
  // Null for a native mint, which keeps the stage's own price display.
  allowanceUnit: MintAllowance | null
  allowanceTotal: bigint | null
  totalNfts: number | null
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
  const blockNow = blockTimeAt(blockSample, nowMs)
  // A stage that has not opened reports no cap, so a zero cap alone cannot tell
  // "not eligible" apart from "not open yet". The schedule can.
  const stageWindowValue = stageWindow(selectedStage, blockNow)
  const stageStartMs = stageWindowValue.startMs
  const stageEndMs = stageWindowValue.endMs
  const stageNotOpen = stageWindowValue.notOpen
  const stageClosed = stageWindowValue.closed

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

  const mintStage =
    selectedStage ?? task.drop?.activeStage ?? task.drop?.nextStage ?? null
  const quantityLimit = selectedStage
    ? quantityCeiling(task.quantityMax, selectedStage)
    : 0
  const capFact =
    selectedStage === null
      ? null
      : task.drop?.source === 'scatter' && selectedStage.maxPerWallet === ''
        ? 'No stated cap'
        : quantityLimit > 0
          ? `Up to ${quantityLimit} per wallet`
          : null
  const unitSize = mintStage?.unitSize ?? 1
  const unitFact = unitSize > 1 ? `${unitSize} NFTs per unit` : null
  const quantityHint =
    [capFact, unitFact].filter((fact): fact is string => fact !== null).join(
      ', '
    ) || null
  const mintQuantity = Number.parseInt(task.quantity, 10)
  const quantityReady = Number.isInteger(mintQuantity) && mintQuantity >= 1
  const isMintingThisTask = input.runningIds.includes(task.id)

  const startRefusal = startRefusalFor(task, activeRuns)
  const canStartMint =
    !locked &&
    task.checked &&
    !task.probing &&
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

  const stagePriceWei = mintStage ? weiFromDecimal(mintStage.priceWei) : null
  const totalsApply = quantityReady && mintWalletCount > 0

  let allowanceUnit: MintAllowance | null = null
  for (const walletId of task.wallets) {
    const row = activeRuns.find((entry) => entry.walletId === walletId)
    const unit = row ? probeFor(row, task.stageUuid)?.allowances[0] : undefined
    if (unit !== undefined) {
      allowanceUnit = unit
      break
    }
  }
  const allowanceTotal =
    allowanceUnit !== null && totalsApply
      ? allowanceUnit.amount * BigInt(mintQuantity) * BigInt(mintWalletCount)
      : null

  const totalNfts =
    mintStage !== null && totalsApply
      ? mintQuantity * unitSize * mintWalletCount
      : null
  const totalWei =
    stagePriceWei !== null && totalsApply
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
    canStartMint,
    mintStage,
    stagePriceWei,
    allowanceUnit,
    allowanceTotal,
    totalNfts,
    totalWei,
  }
}
