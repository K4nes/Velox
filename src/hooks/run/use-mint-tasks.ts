import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useWalletGroups } from '@/hooks/data/use-wallets'
import { usePageStore, usePageStoreScope } from '@/hooks/use-page-store'
import { ARM_TICK_MS, armWait } from '@/lib/mint/arm-schedule'
import { mapLimit } from '@/lib/core/async'
import { WALLET_CONCURRENCY } from '@/lib/core/concurrency'
import { RpcConfigError } from '@/lib/chain/connections'
import { checkWalletEligibility } from '@/lib/opensea/eligibility'
import {
  acceptsTokenId,
  resolveCollectionSource,
} from '@/lib/collection-source'
import {
  checkScatterLists,
  uniqueByAddress,
} from '@/lib/scatter/eligibility'
import { probeScatterMint } from '@/lib/scatter/probe'
import { toMessage } from '@/lib/core/message'
import type { PageStore } from '@/lib/core/page-store'
import {
  abortRunSlot,
  claimRunSlot,
  releaseRunSlot,
  runKindLabel,
} from '@/lib/core/run-slot'
import type { RunSlot } from '@/lib/core/run-slot'
import { mintFailureMessage } from '@/lib/opensea/failure-message'
import { traceMint } from '@/lib/mint/mint-trace'
import {
  buildMintBatch,
  mintForWallet,
  mintQuantityFor,
  mintReadiness,
  pinnedGasLimitOf,
  prepareKeyFor,
  prepareMintEntries,
  stampTaskToken,
  stageConfirmed,
} from '@/lib/mint/run-mint'
import type { PreparedMint } from '@/lib/mint/run-mint'
import { chainTime, waitForReceiptOutcome } from '@/lib/chain/tx'
import { runApprovals } from '@/lib/mint/approve'
import {
  applyProbeVerdicts,
  blockTimeAt,
  clearProbeVerdicts,
  createTask,
  gweiToWei,
  initialQuantity,
  landed,
  mergeCheckedRows,
  mintableRow,
  placeholderTask,
  quantityMaxFor,
  reachedChain,
  rowsFromCheck,
  startRefusalFor,
  stageLiveAt,
  stageStatusFor,
  taskQuantity,
  taskView,
} from '@/lib/mint/mint-task'
import type {
  CheckResult,
  RunStatus,
  Task,
  TaskListItem,
  TaskPatch,
  WalletRun,
} from '@/lib/mint/mint-task'
import { fetchMintDrop } from '@/lib/mint/mint-provider'
import type { DropInfo, DropStage } from '@/lib/opensea/index'
import { listWallets } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'
import { createMintTasksState } from '@/pages/mint/state'
import type { MintTasksState } from '@/pages/mint/state'

const READINESS_FALLBACK_ATTEMPTS = 4

// A task whose check no longer holds. The stage pick and its quantity stay, because
// a re-check recomputes the cap and prefill instead of moving the picker.
const CLEARED_CHECK = {
  status: 'idle',
  checked: false,
  probing: false,
  drop: null,
  arm: null,
} satisfies TaskPatch

// The page unmounts while a check or a mint can still be running, so the epochs
// and in-flight markers outlive it here at module scope. A remount reads the same
// run instead of starting a second one.
const runsRef = new Map<string, number>()
const mintRunRef = new Map<string, number>()
const mintingRef = new Set<string>()
const firingRef = new Set<string>()
const mintSlots = new Map<string, RunSlot>()
const prepareAttemptRef = new Map<string, string>()
const preparingRef = new Set<string>()
const prepareTaskRef = new Map<string, Promise<void>>()
const readinessFailuresRef = new Map<string, number>()
const openCheckRef = new Map<string, { key: string; check: CheckResult }>()
const probeEpochRef = new Map<string, number>()

type BlockSample = { ms: number; at: number; chain: string }

// The chain's clock outlives the page. The arm loop keeps sampling while the
// operator is elsewhere, and a remount reads the last sample instead of the
// desktop clock.
let chainSample: BlockSample | null = null
const chainSampleListeners = new Set<() => void>()

function publishChainSample(sample: BlockSample) {
  chainSample = sample
  for (const listener of chainSampleListeners) listener()
}

function subscribeChainSample(listener: () => void): () => void {
  chainSampleListeners.add(listener)
  return () => {
    chainSampleListeners.delete(listener)
  }
}

// A chain read that fails leaves no sample for that chain. The page then falls
// back to the desktop clock, which is what an unreadable node leaves it with.
function forgetChainSample(chain: string) {
  if (chainSample?.chain !== chain) return
  chainSample = null
  for (const listener of chainSampleListeners) listener()
}

type ArmWindow = { stageUuid: string; startMs: number }

type ArmRunner = {
  tasks: () => Task[]
  prepare: (taskId: string, arm: ArmWindow) => Promise<void>
  open: (taskId: string, blockMs: number) => Promise<void>
  disarm: (taskId: string, message: string) => void
}

type ArmLoop = {
  key: string
  cancelled: boolean
  timer: number | null
  wake: (() => void) | null
}

// The arm belongs to the retained store, not to the page that armed it. The
// page hands over the callbacks; the loop keeps running until the store no
// longer holds the arm.
const armLoops = new Map<string, ArmLoop>()

function stopArmLoop(taskId: string, loop: ArmLoop) {
  loop.cancelled = true
  if (loop.timer !== null) {
    window.clearTimeout(loop.timer)
    loop.timer = null
  }
  const wake = loop.wake
  loop.wake = null
  wake?.()
  if (armLoops.get(taskId) === loop) armLoops.delete(taskId)
}

async function runArmLoop(
  taskId: string,
  runner: ArmRunner,
  loop: ArmLoop
): Promise<void> {
  // The project's TS lib predates Promise.withResolvers.
  const sleep = (ms: number) => {
    let wake = () => {}
    const pending = new Promise<void>((resolve) => {
      wake = resolve
    })
    loop.wake = wake
    loop.timer = window.setTimeout(() => {
      loop.timer = null
      loop.wake = null
      wake()
    }, ms)
    return pending
  }

  // A chain with no usable RPC never recovers on its own, so arming stops instead
  // of counting down to a fire that cannot land.
  const disarmOnRpcError = (error: unknown): boolean => {
    if (!(error instanceof RpcConfigError)) return false
    runner.disarm(taskId, error.message)
    return true
  }

  // One offset for the whole arm. The chain's whole-second timestamps make the
  // local target approximate, which the tight window resolves.
  let offsetMs: number | null = null
  let postOpenDelay = 1_000
  let openReached = false

  try {
    while (!loop.cancelled) {
      const task = runner.tasks().find((entry) => entry.id === taskId)
      const arm = task?.arm
      if (!task || !arm) return
      if (task.status === 'running') {
        await sleep(ARM_TICK_MS)
        continue
      }

      const chain = task.drop?.chain
      if (!chain) {
        runner.disarm(
          taskId,
          'The scheduled mint was cancelled. Check the collection again.'
        )
        return
      }

      if (offsetMs === null) {
        try {
          const ms = await chainTime(chain)
          if (loop.cancelled) return
          offsetMs = ms - Date.now()
          publishChainSample({ ms, at: Date.now(), chain })
          traceMint({ kind: 'poll', taskId, chainMs: ms })
        } catch (error) {
          if (disarmOnRpcError(error)) return
          await sleep(ARM_TICK_MS)
          continue
        }
      }

      const wait = armWait(arm.startMs - offsetMs, Date.now())
      // Prepare off the timer's path: the fire still happens if calldata or a
      // sign-in is slower than the remaining lead time. Once the open has
      // passed, readiness owns calldata, so a second prepare cannot race it.
      if (
        wait.prepare &&
        !openReached &&
        !firingRef.has(taskId) &&
        !prepareTaskRef.has(taskId)
      ) {
        const running = runner.prepare(taskId, arm)
        prepareTaskRef.set(taskId, running)
        const finished = () => {
          if (prepareTaskRef.get(taskId) === running) {
            prepareTaskRef.delete(taskId)
          }
        }
        void running.then(finished, finished)
      }
      if (!wait.tighten) {
        await sleep(wait.delayMs)
        continue
      }

      const tickStart = Date.now()
      try {
        const ms = await chainTime(chain)
        if (loop.cancelled) return
        traceMint({ kind: 'poll', taskId, chainMs: ms })
        publishChainSample({ ms, at: Date.now(), chain })
        if (ms >= arm.startMs) {
          openReached = true
          await runner.open(taskId, ms)
          if (loop.cancelled) return
          const latest = runner.tasks().find((entry) => entry.id === taskId)
          if (!latest?.arm) return
          // Past the open, a failed readiness check must not become four
          // provider round trips a second. Ramp 1s -> 2s -> 4s, cap there.
          await sleep(postOpenDelay)
          postOpenDelay = Math.min(postOpenDelay * 2, 4_000)
          continue
        }
      } catch (error) {
        // An RPC hiccup must not disarm anything; the next tick retries.
        if (disarmOnRpcError(error)) return
      }
      await sleep(Math.max(0, ARM_TICK_MS - (Date.now() - tickStart)))
    }
  } finally {
    if (armLoops.get(taskId) === loop) armLoops.delete(taskId)
  }
}

function syncArmLoops(runner: ArmRunner) {
  const tasks = runner.tasks()
  for (const task of tasks) {
    const arm = task.arm
    if (!arm) continue
    const key = `${arm.stageUuid}:${arm.startMs}`
    const existing = armLoops.get(task.id)
    if (existing?.key === key) continue
    if (existing) stopArmLoop(task.id, existing)
    const loop: ArmLoop = { key, cancelled: false, timer: null, wake: null }
    armLoops.set(task.id, loop)
    void runArmLoop(task.id, runner, loop)
  }
  for (const [taskId, loop] of [...armLoops]) {
    const task = tasks.find((entry) => entry.id === taskId)
    if (!task?.arm) stopArmLoop(taskId, loop)
  }
}

type ProbeRowsInput = {
  id: string
  drop: DropInfo
  stageUuid: string
  baseRows: WalletRun[]
  wallets: StoredWallet[]
  quantity: number
  epoch?: number
  isCurrent?: () => boolean
}

export function useMintTasks(store: PageStore<MintTasksState> | undefined) {
  const scoped = usePageStoreScope(store, createMintTasksState(createTask()))
  const { tasks, activeId, runs, runningIds } = usePageStore(scoped)
  // The countdown renders from a local tick, but the fire decision comes from the
  // chain's clock: a desktop that is a minute off would mint before the stage opens.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const sampled = useSyncExternalStore(subscribeChainSample, () => chainSample)
  const { groups, loading: walletsLoading, error: walletsError } = useWalletGroups()
  const knownWalletIds = useMemo(
    () =>
      new Set(groups.flatMap((group) => group.wallets.map((wallet) => wallet.id))),
    [groups]
  )

  const realActive = tasks.find((task) => task.id === activeId) ?? tasks[0] ?? null
  const active = realActive ?? placeholderTask
  // A sample from another chain says nothing about this drop's stage window.
  const blockSample =
    sampled !== null && sampled.chain === active.drop?.chain ? sampled : null
  const isPlaceholder = realActive === null
  const locked = isPlaceholder
  const hasUrl = active.url.trim().length > 0
  const canPickWallets =
    !locked && !walletsLoading && !runningIds.includes(realActive?.id ?? '')

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
    updateTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task))
    )
  }

  function updateTasks(update: (current: Task[]) => Task[]) {
    scoped.set({ tasks: update(scoped.get().tasks) })
  }

  function updateRuns(
    update: (current: Record<string, WalletRun[]>) => Record<string, WalletRun[]>
  ) {
    scoped.set({ runs: update(scoped.get().runs) })
  }

  function updateRunningIds(update: (current: string[]) => string[]) {
    scoped.set({ runningIds: update(scoped.get().runningIds) })
  }

  function setActiveId(id: string | null) {
    scoped.set({ activeId: id })
  }

  function preparedMintOf(id: string): PreparedMint | undefined {
    return scoped.get().preparedMints.get(id)
  }

  function setPreparedMint(id: string, mint: PreparedMint | null) {
    const next = new Map(scoped.get().preparedMints)
    if (mint === null) {
      next.delete(id)
    } else {
      next.set(id, mint)
    }
    scoped.set({ preparedMints: next })
  }

  function updateActive(patch: TaskPatch) {
    if (!realActive) return
    // A quantity change invalidates the quantity the check priced, so an armed task
    // must not count down to a mint its verdict no longer covers.
    if ('quantity' in patch) {
      clearArmState(realActive.id)
      updateTask(realActive.id, { ...patch, arm: null })
      return
    }
    updateTask(realActive.id, patch)
  }

  function bumpProbeEpoch(id: string): number {
    const epoch = (probeEpochRef.get(id) ?? 0) + 1
    probeEpochRef.set(id, epoch)
    return epoch
  }

  // The same key can live in two folders, and one address must not appear as two
  // rows or spend the probe pace twice.
  async function selectedWallets(walletIds: string[]): Promise<StoredWallet[]> {
    const stored = await listWallets()
    return uniqueByAddress(
      stored.filter((wallet) => walletIds.includes(wallet.id))
    )
  }

  // The probe reads the same clock as the countdown: the chain sample when there
  // is one, otherwise the chain. A failed read falls back to local time. Check
  // does not write the countdown's sample.
  async function stageNowMs(chain: string): Promise<number> {
    const sample = chainSample
    if (sample !== null && sample.chain === chain) {
      return blockTimeAt(sample, Date.now())
    }
    try {
      return await chainTime(chain)
    } catch {
      return Date.now()
    }
  }

  // OpenSea states the active stage itself. A Scatter list's active stage is
  // derived from whatever clock fetched the drop, so its own window on chain is
  // the authority: a list the desktop thinks is open is not probed until the
  // chain says it opened, and a stage the chain says is live is probed even when
  // the desktop clock has not reached it.
  async function stageProbeable(
    drop: DropInfo,
    stage: DropStage | null
  ): Promise<boolean> {
    if (!stage) return false
    if (drop.source !== 'scatter' && drop.activeStage?.uuid === stage.uuid) {
      return true
    }
    return stageLiveAt(stage, await stageNowMs(drop.chain))
  }

  async function probeRows(
    input: ProbeRowsInput
  ): Promise<WalletRun[] | null> {
    const {
      id,
      drop,
      stageUuid,
      baseRows,
      wallets,
      quantity,
      epoch: providedEpoch,
      isCurrent,
    } = input
    if (wallets.length === 0) return null

    const epoch = providedEpoch ?? bumpProbeEpoch(id)
    const verdicts = await probeScatterMint({
      drop,
      listId: stageUuid,
      wallets,
      quantity,
      isCurrent: () =>
        probeEpochRef.get(id) === epoch && (isCurrent?.() ?? true),
    })
    if (probeEpochRef.get(id) !== epoch) return null
    if (isCurrent && !isCurrent()) return null
    return applyProbeVerdicts(baseRows, stageUuid, verdicts)
  }

  async function probeIfLive(
    input: Omit<ProbeRowsInput, 'stageUuid'> & { stage: DropStage | null }
  ): Promise<WalletRun[] | null> {
    if (!input.stage) return null
    if (!(await stageProbeable(input.drop, input.stage))) return null
    return probeRows({ ...input, stageUuid: input.stage.uuid })
  }

  async function probeStage(
    id: string,
    stageUuid: string,
    epoch: number
  ): Promise<void> {
    const task = scoped.get().tasks.find((entry) => entry.id === id)
    const drop = task?.drop
    try {
      if (
        !task ||
        !task.checked ||
        task.stageUuid !== stageUuid ||
        !drop ||
        drop.source !== 'scatter' ||
        stageUuid === ''
      ) {
        return
      }
      const stage = drop.stages.find((entry) => entry.uuid === stageUuid) ?? null
      const baseRows = scoped.get().runs[id] ?? []
      const wallets = await selectedWallets(task.wallets)
      const probed = await probeIfLive({
        id,
        drop,
        stage,
        baseRows,
        wallets,
        quantity: taskQuantity(task),
        epoch,
      })
      if (probed === null) return
      // A run owns the row once it starts. Its build is the authority from then on.
      if (mintingRef.has(id) || scoped.get().runningIds.includes(id)) return

      const current = scoped.get().tasks.find((entry) => entry.id === id)
      if (!current || current.stageUuid !== stageUuid || !current.checked) return

      updateRuns((runs) => ({ ...runs, [id]: probed }))
      updateTask(id, {
        quantityMax: quantityMaxFor(probed, current.wallets, stageUuid),
      })

      // A probe that lands after the operator armed must not leave a blocked task
      // counting down.
      const refusal = startRefusalFor(current, probed)
      if (refusal !== null && current.arm?.stageUuid === stageUuid) {
        updateTask(id, { arm: null })
        toast.error(refusal)
      }
    } catch (error) {
      if (probeEpochRef.get(id) !== epoch) return
      const current = scoped.get().tasks.find((entry) => entry.id === id)
      if (!current || current.stageUuid !== stageUuid) return
      const rows = scoped.get().runs[id] ?? []
      const verdicts = new Map(
        rows
          .filter((row) => current.wallets.includes(row.walletId))
          .map((row) => [
            row.walletId,
            { status: 'failed' as const, error: toMessage(error) },
          ])
      )
      const probed = applyProbeVerdicts(rows, stageUuid, verdicts)
      updateRuns((runs) => ({ ...runs, [id]: probed }))
      updateTask(id, {
        quantityMax: quantityMaxFor(probed, current.wallets, stageUuid),
      })
    } finally {
      const current = scoped.get().tasks.find((entry) => entry.id === id)
      if (
        current?.stageUuid === stageUuid &&
        probeEpochRef.get(id) === epoch
      ) {
        updateTask(id, { probing: false })
      }
    }
  }

  function cancelRun(id: string) {
    runsRef.set(id, (runsRef.get(id) ?? 0) + 1)
  }

  function cancelMint(id: string) {
    mintRunRef.set(id, (mintRunRef.get(id) ?? 0) + 1)
    const slot = mintSlots.get(id)
    if (slot) abortRunSlot(slot)
  }

  function finishMint(id: string) {
    mintingRef.delete(id)
    updateRunningIds((current) => current.filter((value) => value !== id))
    const slot = mintSlots.get(id)
    if (slot) {
      releaseRunSlot(slot)
      mintSlots.delete(id)
    }
  }

  function clearArmState(id: string) {
    setPreparedMint(id, null)
    prepareAttemptRef.delete(id)
    prepareTaskRef.delete(id)
    readinessFailuresRef.delete(id)
    openCheckRef.delete(id)
  }

  function addTask() {
    const task = createTask()
    updateTasks((current) => [...current, task])
    setActiveId(task.id)
  }

  function closeTask(id: string) {
    // The loop is still suspended in an await, and closing would throw away the
    // hash of a transaction that already reached the chain.
    if (mintingRef.has(id)) return

    const index = tasks.findIndex((task) => task.id === id)
    if (index === -1) return

    bumpProbeEpoch(id)
    cancelRun(id)
    cancelMint(id)
    finishMint(id)
    clearArmState(id)
    runsRef.delete(id)
    mintRunRef.delete(id)
    probeEpochRef.delete(id)
    updateRuns((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })

    const remaining = tasks.filter((task) => task.id !== id)

    updateTasks(() => remaining)
    if (realActive?.id === id) {
      const neighbour = remaining[index] ?? remaining[index - 1] ?? null
      setActiveId(neighbour ? neighbour.id : null)
    }
  }

  // A verdict names the token or the wallets it was read for, so it cannot survive a
  // reset. A landed row is a chain fact: keep its hash and the stages it retired.
  function resetCheck(id: string, patch: TaskPatch) {
    bumpProbeEpoch(id)
    cancelRun(id)
    clearArmState(id)
    updateRuns((current) => ({
      ...current,
      [id]: (current[id] ?? []).filter(landed),
    }))
    updateTask(id, { ...patch, ...CLEARED_CHECK })
  }

  function changeUrl(url: string) {
    if (!realActive || mintingRef.has(realActive.id)) return
    // A token page states the token, so it wins. A collection URL states none, so
    // it keeps a typed token only while the collection stays the same. Any other
    // URL, or another collection, leaves the task with no token.
    const collection = resolveCollectionSource(url)
    const previous = resolveCollectionSource(realActive.url)
    const fromUrl = collection?.tokenId ?? ''
    const sameCollection =
      collection !== null &&
      previous !== null &&
      collection.source === previous.source &&
      collection.slug === previous.slug
    const tokenId =
      fromUrl !== ''
        ? fromUrl
        : collection !== null && acceptsTokenId(collection.source) && sameCollection
          ? realActive.tokenId
          : ''
    resetCheck(realActive.id, { name: 'Task', url, tokenId })
  }

  function changeTokenId(tokenId: string) {
    if (!realActive || mintingRef.has(realActive.id)) return
    if (realActive.tokenId === tokenId) return
    resetCheck(realActive.id, { tokenId })
  }

  function setWallets(ids: string[]) {
    if (!realActive) return
    resetCheck(realActive.id, {
      wallets: ids,

      stageUuid: '',
      quantityMax: 0,
      quantity: '1',
    })
  }

  function selectStage(uuid: string) {
    if (!realActive) return
    const liveTask = scoped.get().tasks.find((entry) => entry.id === realActive.id)
    if (!liveTask || liveTask.stageUuid === uuid) return
    const id = realActive.id
    clearArmState(id)
    const epoch = bumpProbeEpoch(id)
    const cleared = clearProbeVerdicts(scoped.get().runs[id] ?? [])
    updateRuns((current) => ({ ...current, [id]: cleared }))
    const max = quantityMaxFor(cleared, realActive.wallets, uuid)
    const stage = realActive.drop?.stages.find((entry) => entry.uuid === uuid) ?? null
    updateTask(id, {
      stageUuid: uuid,
      quantityMax: max,
      arm: null,
      probing: true,
      quantity: initialQuantity(max, stage),
    })
    void probeStage(id, uuid, epoch)
  }

  async function check(
    target?: Task,
    dropOverride?: DropInfo,
    options: { probe?: boolean } = {}
  ): Promise<CheckResult | null> {
    const task = target ?? realActive
    if (!task || task.status === 'running' || task.url.trim().length === 0) {
      return null
    }
    if (mintingRef.has(task.id)) return null

    const id = task.id
    const url = task.url
    const walletIds = [...task.wallets]
    const probeQuantity = taskQuantity(task)
    bumpProbeEpoch(id)
    const run = (runsRef.get(id) ?? 0) + 1
    runsRef.set(id, run)
    updateTask(id, { status: 'running', checked: false, probing: false })

    const stale = () => runsRef.get(id) !== run
    const isCurrent = () => !stale()
    const collection = resolveCollectionSource(url)

    if (!collection) {
      updateTask(id, {
        name: 'Task',
        status: 'failed',
        checked: false,
        probing: false,
        drop: null,
      })
      toast.error('Check failed — collection URL not recognised')
      return null
    }

    let step: 'drop' | 'eligibility' = 'drop'
    let checked = false
    traceMint({ kind: 'check-start', taskId: id })

    try {
      let drop: DropInfo
      if (dropOverride) {
        drop = dropOverride
        step = 'eligibility'
      } else {
        drop = await fetchMintDrop(collection.source, collection.slug)
        if (stale()) return null
      }
      // The provider states no token ID. The task's field carries the token a URL
      // filled or the operator typed, and an OpenSea task never holds one.
      drop = stampTaskToken(drop, task)

      // The SeaDrop restriction describes the OpenSea route. Scatter mints any
      // contract type through one endpoint, so the guard must not apply to it.
      if (drop.source === 'opensea' && drop.dropType !== 'seadrop_v1_erc721') {
        updateTask(id, {
          status: 'failed',
          checked: false,
          probing: false,
          drop: null,
        })
        toast.error('Only SeaDrop ERC-721 drops are supported')
        return null
      }

      step = 'eligibility'
      const selected = await selectedWallets(walletIds)
      if (stale()) return null

      if (selected.length === 0) {
        updateTask(id, {
          status: 'failed',
          checked: false,
          probing: false,
          drop: null,
        })
        toast.error('Select at least one wallet')
        return null
      }

      const rows =
        drop.source === 'scatter'
          ? await checkScatterLists(drop, selected)
          : await checkWalletEligibility(drop, selected)
      if (stale()) return null

      // The operator can pick a stage while the check runs. Read the live task,
      // not the snapshot taken when the check started, or that pick is reverted.
      const live = scoped.get().tasks.find((entry) => entry.id === id) ?? task
      const keptStage = drop.stages.some((entry) => entry.uuid === live.stageUuid)
      const stageUuid = keptStage ? live.stageUuid : (drop.activeStage?.uuid ?? '')
      const stage = drop.stages.find((entry) => entry.uuid === stageUuid) ?? null
      const checkedRows = rowsFromCheck(rows, stageUuid)
      const baseRows = mergeCheckedRows(checkedRows, scoped.get().runs[id] ?? [])
      let probedStage: string | null = null
      let probedRows = baseRows
      const shouldProbe = options.probe !== false && drop.source === 'scatter'
      const probeList = async (target: DropStage | null) => {
        const rows = await probeIfLive({
          id,
          drop,
          stage: target,
          baseRows,
          wallets: selected,
          quantity: probeQuantity,
          isCurrent,
        })
        return stale()
          ? ({ stale: true } as const)
          : ({ stale: false, rows } as const)
      }

      // The build is free and returns unsigned calldata, so the check can learn
      // whether every wallet would really mint before the operator arms or starts.
      if (shouldProbe) {
        const probe = await probeList(stage)
        if (probe.stale) return null
        if (probe.rows !== null) {
          probedStage = stageUuid
          probedRows = probe.rows
        }
      }

      // A stage change while the probe ran owns the task. Keep the operator's pick
      // rather than applying a verdict taken against the list they left.
      const current =
        scoped.get().tasks.find((entry) => entry.id === id) ?? live
      const finalStageUuid = drop.stages.some(
        (entry) => entry.uuid === current.stageUuid
      )
        ? current.stageUuid
        : (drop.activeStage?.uuid ?? '')
      const finalStage =
        drop.stages.find((entry) => entry.uuid === finalStageUuid) ?? null
      let finalRows = probedStage === finalStageUuid ? probedRows : baseRows
      // A stage change during the build leaves the first probe without a verdict
      // for the list the operator now has. Probe the final list before publishing
      // rows, so Check never shows an unprobed row as ready.
      if (shouldProbe && finalStageUuid !== probedStage) {
        const retry = await probeList(finalStage)
        if (retry.stale) return null
        if (retry.rows !== null) finalRows = retry.rows
      }
      const quantityMax = quantityMaxFor(
        finalRows,
        current.wallets,
        finalStageUuid
      )
      // A stage change after the check's last read owns the pick. Publish the task
      // without the stale rows, then probe the list the operator actually selected.
      const latest =
        scoped.get().tasks.find((entry) => entry.id === id) ?? current
      const latestStageUuid = drop.stages.some(
        (entry) => entry.uuid === latest.stageUuid
      )
        ? latest.stageUuid
        : finalStageUuid
      if (latestStageUuid !== finalStageUuid) {
        updateTask(id, {
          name: drop.name || collection.slug,
          status: 'idle',
          checked: true,
          drop,
          stageUuid: latestStageUuid,
          probing: shouldProbe,
        })
        if (shouldProbe) {
          const latestEpoch = bumpProbeEpoch(id)
          await probeStage(id, latestStageUuid, latestEpoch)
        }
        checked = true
        return {
          drop,
          rows: scoped.get().runs[id] ?? finalRows,
          quantityMax:
            scoped.get().tasks.find((entry) => entry.id === id)?.quantityMax ??
            quantityMax,
        }
      }

      updateRuns((currentRuns) => ({ ...currentRuns, [id]: finalRows }))
      // A token-priced probe priced one quantity. Prefilling to the cap would
      // invalidate the allowance read the operator just paid for, and Start would
      // refuse a task the row had already proved. Raising it still needs a new
      // Check, which is the stale guard.
      const tokenPriced = finalRows.some(
        (row) =>
          row.probe?.stageUuid === finalStageUuid &&
          row.probe.allowances.length > 0
      )
      const prefill =
        quantityMax > 0 ? Math.min(probeQuantity, quantityMax) : probeQuantity
      updateTask(id, {
        name: drop.name || collection.slug,
        status: 'idle',
        checked: true,
        drop,
        stageUuid: finalStageUuid,
        quantityMax,
        probing: false,
        quantity: tokenPriced
          ? String(prefill)
          : initialQuantity(quantityMax, finalStage),
      })
      checked = true
      return { drop, rows: finalRows, quantityMax }
    } catch (error) {
      if (stale()) return null
      updateTask(id, {
        status: 'failed',
        checked: false,
        probing: false,
        drop: null,
      })
      toast.error(mintFailureMessage(error, step))
      return null
    } finally {
      traceMint({ kind: 'check-end', taskId: id, ok: checked })
    }
  }

  // `prepared` carries a check that just landed, so an armed run mints from the
  // rows it computed instead of the ones React has not committed yet.
  // `preparedMint` carries calldata built before the open; a stage or quantity
  // change makes its key stale and the commit rebuilds it.
  async function startMint(
    target?: Task,
    options: {
      prepared?: CheckResult
      drop?: DropInfo
      stageVerified?: boolean
      preparedMint?: PreparedMint
    } = {}
  ) {
    const prepared = options.prepared
    const task = target ?? realActive
    if (!task || !task.drop || task.probing || mintingRef.has(task.id)) return

    const id = task.id
    // A run owns the rows from its first line. A probe already in flight must not
    // land afterwards and restore its pre-run snapshot.
    bumpProbeEpoch(id)
    // The re-checked drop wins: an armed fire re-reads the drop, so the older copy must
    // not be what the run mints against. The token is the task's, whatever copy the
    // caller passed, and only a provider that mints editions may carry it.
    const sourceDrop = prepared?.drop ?? options.drop ?? task.drop
    const drop = stampTaskToken(sourceDrop, task)
    const refusal = startRefusalFor(
      task,
      prepared?.rows ?? scoped.get().runs[id] ?? []
    )
    // A blocked task builds nothing: the fix is in the task, and a run would only
    // spend gas discovering the same refusal wallet by wallet.
    if (refusal !== null) {
      toast.error(refusal)
      return
    }
    const stage =
      drop.stages.find((entry) => entry.uuid === task.stageUuid) ?? null
    const quantity = mintQuantityFor(
      task,
      prepared ? prepared.quantityMax : task.quantityMax,
      stage
    )
    const gasLimitInput = Number.parseInt(task.gasLimit, 10)

    if (quantity === null) {
      toast.error('Quantity must be at least 1')
      return
    }

    // A token-priced build states the amount to approve, and that amount can go stale
    // between the pre-open prepare and the fire. Those entries are rebuilt with the rest
    // of the batch, so the approval always matches the mint that spends it.
    const preparedEntries =
      options.preparedMint?.key === prepareKeyFor(task, quantity) &&
      options.preparedMint.entries.every(
        (entry) => entry.transaction.allowances.length === 0
      )
        ? new Map(
            options.preparedMint.entries.map((entry) => [
              entry.walletId,
              entry,
            ])
          )
        : null

    mintingRef.add(id)
    const run = (mintRunRef.get(id) ?? 0) + 1
    mintRunRef.set(id, run)
    const superseded = () => mintRunRef.get(id) !== run
    // The slot is what a mint run never held: another flow sees it as busy, and
    // an abort from cancelMint stops the wallet loop below.
    const claim = await claimRunSlot('mint', undefined, superseded)
    if (claim.kind !== 'acquired') {
      mintingRef.delete(id)
      if (claim.kind === 'busy') toast.error(runKindLabel(claim.running))
      return
    }
    mintSlots.set(id, claim.slot)
    const stopped = () => superseded() || claim.slot.aborted
    updateRunningIds((current) => [...current, id])

    try {
      const fresh = options.drop ?? (await fetchMintDrop(drop.source, drop.slug))
      if (stopped()) return
      // Scatter's fetch picks its active list from the desktop clock, so the
      // list's own window on the chain decides whether it can mint. OpenSea
      // states the active stage from its server, and its SeaDrop restriction is
      // the authority there.
      const freshStage =
        fresh.stages.find((entry) => entry.uuid === task.stageUuid) ?? null
      const chainNow = blockTimeAt(
        chainSample !== null && chainSample.chain === fresh.chain
          ? chainSample
          : null,
        Date.now()
      )
      const scatterStageOpen =
        fresh.source === 'scatter' && stageLiveAt(freshStage, chainNow)
      // The endpoint sends only minter and quantity, so it mints the live stage
      // whatever the picker says. Sending a batch built from another stage would
      // mint A for wallets counted against B, and the doomed retry would wipe the
      // record of a transaction that already landed. A Scatter build names its
      // list, so the task's stage is the live one once its own window is open.
      const liveStageUuid = options.stageVerified
        ? task.stageUuid
        : fresh.source === 'scatter'
          ? scatterStageOpen
            ? task.stageUuid
            : ''
          : (fresh.activeStage?.uuid ?? '')
      if (!options.stageVerified && liveStageUuid === '') {
        updateRuns((current) => ({
          ...current,
          [id]: (current[id] ?? []).filter(reachedChain),
        }))
        updateTask(id, {
          drop: null,
          checked: false,
          stageUuid: '',
          quantityMax: 0,
          quantity: '1',
          status: 'failed',
        })
        toast.error('No stage is minting. Check the collection again.')
        return
      }
      if (!options.stageVerified && liveStageUuid !== task.stageUuid) {
        updateTask(id, { checked: false })
        toast.error('The live stage changed. Check the collection again.')
        return
      }
      const atStage = <T extends Partial<WalletRun>>(
        patch: T
      ): T & { statusStage: string } => ({
        ...patch,
        statusStage: liveStageUuid,
      })

      // Resetting a deselected row would erase the landing that keeps its wallet
      // retired on this stage.
      const mintable = new Set(
        (prepared?.rows ?? runs[id] ?? [])
          .filter(
            (row) =>
              task.wallets.includes(row.walletId) &&
              mintableRow(row, task.stageUuid)
          )
          .map((row) => row.walletId)
      )
      const selected = (await listWallets()).filter(
        (wallet) =>
          task.wallets.includes(wallet.id) && mintable.has(wallet.id)
      )

      if (selected.length === 0) {
        toast.error('No wallet can mint this stage')
        return
      }
      if (stopped()) return

      const gas = {
        gasLimit:
          Number.isFinite(gasLimitInput) && gasLimitInput > 0
            ? BigInt(gasLimitInput)
            : undefined,
        maxFeePerGas: gweiToWei(task.maxFee),
        maxPriorityFeePerGas: gweiToWei(task.priorityFee),
      }
      // The row reports progress from the first build, and every build now happens before
      // any send, so the whole batch reads Minting while its calldata is read.
      updateRuns((current) => ({
        ...current,
        [id]: (current[id] ?? []).map((row) =>
          mintable.has(row.walletId)
            ? atStage({
                ...row,
                status: 'minting' as const,
                checkFailed: false,
                txHash: undefined,
                chain: undefined,
                error: undefined,
                log: undefined,
              })
            : row
        ),
      }))

      // A build whose allowance requirement cannot be resolved is the task's problem,
      // not the wallet's, so every build is read before any wallet signs.
      const batch = await buildMintBatch({
        drop,
        stageUuid: liveStageUuid,
        quantity,
        wallets: selected,
        prepared: preparedEntries,
        isCurrent: () => !stopped(),
      })
      if (batch.refusal !== null) {
        const refusal = batch.refusal
        updateRuns((current) => ({
          ...current,
          [id]: (current[id] ?? []).map((row) =>
            mintable.has(row.walletId)
              ? atStage({ ...row, status: 'blocked' as const, error: refusal })
              : row
          ),
        }))
        toast.error(refusal)
        return
      }
      const calldata = batch.entries

      const updateRun = (
        walletId: string,
        patch: (row: WalletRun) => Partial<WalletRun>
      ) => {
        if (stopped()) return
        updateRuns((current) => ({
          ...current,
          [id]: (current[id] ?? []).map((entry) =>
            entry.walletId === walletId
              ? { ...entry, ...atStage(patch(entry)) }
              : entry
          ),
        }))
      }

      // A stop arrives exactly when the last transaction is in flight, so the record of
      // what already reached the chain must outlive the guard the progress updates use.
      const writeRun = (
        walletId: string,
        patch: (row: WalletRun) => Partial<WalletRun>
      ) => {
        updateRuns((current) => ({
          ...current,
          [id]: (current[id] ?? []).map((entry) =>
            entry.walletId === walletId
              ? { ...entry, ...atStage(patch(entry)) }
              : entry
          ),
        }))
      }

      const appendLine = (log: string | undefined, line: string) =>
        log === undefined || log === '' ? line : `${log}\n${line}`

      const broadcast: {
        walletId: string
        chain: string
        txHash: string
        from: `0x${string}`
        nonce: number
        to: `0x${string}`
        input: `0x${string}`
        value: bigint
      }[] = []

      // Two wallets at a time, handed out in wallet-list order so wallet 0 is
      // in the first pair.
      await mapLimit(selected, WALLET_CONCURRENCY, async (wallet) => {
        if (stopped()) return
        const preparedEntry = calldata.get(wallet.id)
        // No calldata means this wallet was never built, and the send path cannot build.
        // That is what keeps an unresolved allowance refusal from arriving after another
        // wallet has signed, so the row reports why it was skipped instead.
        if (!preparedEntry) {
          updateRun(wallet.id, () => ({
            status: 'failed',
            error:
              batch.failures.get(wallet.id) ??
              'No calldata was built for this wallet',
          }))
          return
        }
        let approvalLog = ''
        try {
          // A token-priced list is granted here, inside the wallet's own turn, so the
          // approval and the mint that spends it stay ordered. A native list pays no
          // read and sends nothing.
          const approval = await runApprovals({
            wallet,
            chainSlug: preparedEntry.transaction.chain,
            allowances: preparedEntry.transaction.allowances,
            gas,
            shouldAbort: stopped,
            onApproving: () =>
              updateRun(wallet.id, (row) => ({
                status: 'approving',
                txHash: undefined,
                chain: undefined,
                error: undefined,
                log: row.log,
              })),
          })
          approvalLog = approval.log.join('\n')

          if (approval.kind === 'failed') {
            const stage =
              approval.stage === 'balance' ? 'Balance check' : 'Approval'
            updateRun(wallet.id, () => ({
              status: 'failed',
              error: approval.error,
              log: appendLine(
                approvalLog,
                `${stage} failed: ${approval.error}`
              ),
            }))
            return
          }
          if (approval.kind === 'aborted') {
            if (approvalLog !== '') {
              writeRun(wallet.id, () => ({
                status: 'failed',
                error:
                  'The run stopped after the approval; the mint was not sent.',
                log: appendLine(
                  approvalLog,
                  'Mint not sent: the run stopped after the approval.'
                ),
              }))
            }
            return
          }
          if (stopped()) return

          const result = await mintForWallet({
            wallet,
            gas: preparedEntry.gasLimit
              ? { ...gas, gasLimit: preparedEntry.gasLimit }
              : gas,
            transaction: preparedEntry.transaction,
            shouldAbort: stopped,
          })
          // The hash is a chain fact: a stop that lands while the send confirms must not
          // erase the only record of a transaction that already reached the node.
          writeRun(wallet.id, (row) => ({
            status: 'broadcast',
            txHash: result.txHash,
            chain: result.chain,
            mintedStages: [...row.mintedStages, liveStageUuid],
            log: appendLine(approvalLog, `Mint ${result.txHash}.`),
          }))
          broadcast.push({
            walletId: wallet.id,
            chain: result.chain,
            txHash: result.txHash,
            from: result.from,
            nonce: result.nonce,
            to: preparedEntry.transaction.to as `0x${string}`,
            input: preparedEntry.transaction.data as `0x${string}`,
            value: BigInt(preparedEntry.transaction.value),
          })
        } catch (error) {
          if (stopped()) return
          updateRun(wallet.id, () => ({
            status: 'failed',
            error: toMessage(error),
            log: appendLine(
              approvalLog,
              `Mint failed: ${toMessage(error)}`
            ),
          }))
        }
      })

      // A stop ends the batch, but a row that never reached the chain must not stay
      // Minting forever. Every untouched row records why it stopped.
      if (stopped()) {
        updateRuns((current) => ({
          ...current,
          [id]: (current[id] ?? []).map((row) =>
            mintable.has(row.walletId) &&
            (row.status === 'minting' || row.status === 'approving')
              ? {
                  ...row,
                  ...atStage({
                    status: 'failed' as const,
                    error: 'The run stopped before anything was sent.',
                  }),
                }
              : row
          ),
        }))
      }

      // Receipts are independent reads, so they can outrun the send cap. A stop does not
      // skip a read already in flight, and a read it skips says so on the row.
      await mapLimit(broadcast, 4, async (entry) => {
        if (stopped()) {
          writeRun(entry.walletId, (row) => ({
            log: appendLine(
              row.log,
              'Receipt not read: the run stopped after the broadcast.'
            ),
          }))
          return
        }
        // A reorged outcome needs the nonce slot: the sender's replacement may be
        // what actually mined, and only its receipt says whether this mint landed.
        const outcome = await waitForReceiptOutcome(entry.chain, entry.txHash, {
          from: entry.from,
          nonce: entry.nonce,
          to: entry.to,
          input: entry.input,
          value: entry.value,
        })
        writeRun(entry.walletId, (row) => {
          if (outcome.status === 'success') {
            return {
              status: 'confirmed' as const,
              txHash: outcome.txHash,
              ...(outcome.txHash.toLowerCase() !== entry.txHash.toLowerCase()
                ? {
                    log: appendLine(
                      row.log,
                      `Mint repriced to ${outcome.txHash}.`
                    ),
                  }
                : {}),
            }
          }
          // The mint did not land. Retiring the stage would leave Check + Start
          // with no retry and no reason, so only a still-possible transaction
          // keeps the retirement.
          if (outcome.status === 'reverted') {
            return {
              status: 'failed' as const,
              txHash: outcome.txHash,
              error: 'Transaction reverted',
              mintedStages: row.mintedStages.filter(
                (stage) => stage !== liveStageUuid
              ),
              log: appendLine(row.log, 'Mint failed: the transaction reverted.'),
            }
          }
          if (outcome.status === 'replaced') {
            return {
              status: 'failed' as const,
              error: 'The transaction was replaced before it minted',
              mintedStages: row.mintedStages.filter(
                (stage) => stage !== liveStageUuid
              ),
              log: appendLine(
                row.log,
                `Mint replaced by ${outcome.txHash}; the replacement did not mint this stage.`
              ),
            }
          }
          return {
            log: appendLine(
              row.log,
              'Receipt unresolved: the transaction may still land.'
            ),
          }
        })
      })
    } catch (error) {
      const message = `Mint failed — ${toMessage(error)}`
      updateTask(id, { status: 'failed' })
      toast.error(message)
    } finally {
      finishMint(id)
    }
  }

  function armStage() {
    if (!realActive || !active.drop || realActive.probing) return
    const refusal = startRefusalFor(
      realActive,
      scoped.get().runs[realActive.id] ?? []
    )
    // An arm is a promised fire; a task that cannot start must not count down to one.
    if (refusal !== null) {
      toast.error(refusal)
      return
    }
    const stage =
      active.drop.stages.find((entry) => entry.uuid === active.stageUuid) ?? null
    if (!stage?.startTime) return
    const startMs = Date.parse(stage.startTime)
    if (!Number.isFinite(startMs)) return
    setNowMs(Date.now())
    updateTask(realActive.id, { arm: { stageUuid: stage.uuid, startMs } })
  }

  function disarmStage() {
    if (!realActive) return
    clearArmState(realActive.id)
    updateTask(realActive.id, { arm: null })
  }

  function stopMint() {
    if (!realActive) return
    cancelMint(realActive.id)
  }

  async function prepareArmed(
    taskId: string,
    arm: { stageUuid: string; startMs: number }
  ): Promise<void> {
    // openArmed owns calldata once it starts firing. A prepare racing it would
    // issue a second /mint request and break the single open-time fetch.
    if (firingRef.has(taskId)) return
    const task = scoped.get().tasks.find((entry) => entry.id === taskId)
    if (
      !task ||
      !task.arm ||
      !task.drop ||
      task.arm.stageUuid !== arm.stageUuid ||
      task.arm.startMs !== arm.startMs
    ) {
      return
    }
    const stage =
      task.drop.stages.find((entry) => entry.uuid === arm.stageUuid) ?? null
    if (!stage) return
    const quantity = mintQuantityFor(task, task.quantityMax, stage)
    if (quantity === null) return

    const key = prepareKeyFor(task, quantity)
    if (preparedMintOf(taskId)?.key === key) return
    if (prepareAttemptRef.get(taskId) === key) return
    if (preparingRef.has(taskId)) return
    prepareAttemptRef.set(taskId, key)
    preparingRef.add(taskId)

    try {
      const mintable = new Set(
        (scoped.get().runs[taskId] ?? [])
          .filter(
            (row) =>
              task.wallets.includes(row.walletId) &&
              mintableRow(row, task.stageUuid)
          )
          .map((row) => row.walletId)
      )
      const selected = (await listWallets()).filter(
        (wallet) =>
          task.wallets.includes(wallet.id) && mintable.has(wallet.id)
      )
      if (selected.length === 0) return

      const entries = await prepareMintEntries({
        task,
        drop: task.drop,
        quantity,
        wallets: selected,
        pinnedGasLimit: pinnedGasLimitOf(task),
        isCurrent: () => {
          const current = scoped.get().tasks.find((entry) => entry.id === taskId)
          return (
            current?.arm !== null &&
            current?.arm?.stageUuid === arm.stageUuid &&
            current?.arm?.startMs === arm.startMs
          )
        },
      })
      if (entries === null) return

      const current = scoped.get().tasks.find((entry) => entry.id === taskId)
      if (
        !current?.arm ||
        current.arm.stageUuid !== arm.stageUuid ||
        current.arm.startMs !== arm.startMs
      ) {
        return
      }
      setPreparedMint(taskId, {
        key: prepareKeyFor(current, quantity),
        entries,
      })
    } catch {
      // Best-effort: openArmed and the commit rebuild what is missing.
    } finally {
      preparingRef.delete(taskId)
    }
  }

  async function openArmed(taskId: string, blockMs: number) {
    const task = scoped.get().tasks.find((entry) => entry.id === taskId)
    const arm = task?.arm
    if (!task || !arm || !task.drop || firingRef.has(taskId)) return
    firingRef.add(taskId)
    const armKey = `${taskId}:${arm.stageUuid}:${arm.startMs}`
    try {
      // A prepare started just before the open can still be in flight. Let it
      // settle so readiness reuses its calldata instead of fetching a second
      // copy.
      const pendingPrepare = prepareTaskRef.get(taskId)
      if (pendingPrepare) await pendingPrepare
      const drop = await fetchMintDrop(task.drop.source, task.drop.slug)
      // The operator can disarm, or arm a different stage, while the drop is in
      // flight. Re-read before acting, or a cancelled run still spends gas.
      const latest = scoped.get().tasks.find((entry) => entry.id === taskId)
      if (!latest || latest.arm?.stageUuid !== arm.stageUuid) return
      const stage =
        drop.stages.find((entry) => entry.uuid === arm.stageUuid) ?? null
      const endMs = stage?.endTime ? Date.parse(stage.endTime) : NaN
      if (!stage || (Number.isFinite(endMs) && blockMs >= endMs)) {
        updateTask(taskId, { arm: null })
        clearArmState(taskId)
        toast.error('The scheduled stage closed before it opened.')
        return
      }

      // A different active_stage that is still inside its own window is a real
      // stage change on OpenSea. A stale one whose window has closed does not
      // block the scheduled fire; the calldata check below is the authority on
      // the open. A Scatter build names its own list, so another live list is
      // not a change.
      const active = drop.activeStage
      const activeStart = active?.startTime ? Date.parse(active.startTime) : NaN
      const activeEnd = active?.endTime ? Date.parse(active.endTime) : NaN
      const activeLive =
        active !== null &&
        (!Number.isFinite(activeStart) || activeStart <= blockMs) &&
        (!Number.isFinite(activeEnd) || blockMs < activeEnd)
      if (
        drop.source !== 'scatter' &&
        active &&
        active.uuid !== arm.stageUuid &&
        activeLive
      ) {
        toast.error('The live stage changed. Check the collection again.')
        return
      }

      // A check that started while the drop was in flight owns the task now; the
      // next tick retries with the arm intact.
      if (latest.status === 'running') return

      // Caps can appear only when the stage opens, so readiness must start from
      // the rows of an open-time check, not the pre-open ones. Keep that check
      // across readiness retries instead of re-running eligibility every tick.
      let checked = openCheckRef.get(taskId)
      if (checked?.key !== armKey) {
        // The probe is a pre-run courtesy. At the open it would only delay the fire,
        // so the batch build inside the run is the guard that matters here.
        const result = await check(latest, drop, { probe: false })
        if (!result) {
          updateTask(taskId, { arm: null })
          clearArmState(taskId)
          return
        }
        checked = { key: armKey, check: result }
        openCheckRef.set(taskId, checked)
      }

      const current = scoped.get().tasks.find((entry) => entry.id === taskId)
      if (!current?.arm || current.arm.stageUuid !== arm.stageUuid) return
      const quantity = mintQuantityFor(latest, checked.check.quantityMax, stage)
      if (quantity === null) {
        updateTask(taskId, { arm: null })
        clearArmState(taskId)
        toast.error('Quantity must be at least 1')
        return
      }

      const readiness = await mintReadiness({
        task: latest,
        drop: checked.check.drop,
        quantity,
        rows: checked.check.rows,
        preparedMint: preparedMintOf(taskId),
      })
      if (readiness.candidates === 0) {
        updateTask(taskId, { arm: null })
        clearArmState(taskId)
        toast.error('No wallet can mint this stage')
        return
      }

      const ready = await stageConfirmed(drop.chain, readiness.entries)
      if (!ready) {
        const failures = (readinessFailuresRef.get(taskId) ?? 0) + 1
        readinessFailuresRef.set(taskId, failures)
        // Calldata that failed at the open must not be reused on every retry.
        setPreparedMint(taskId, null)
        prepareAttemptRef.delete(taskId)
        if (failures < READINESS_FALLBACK_ATTEMPTS) return

        // A Scatter list is confirmed by its own window; OpenSea by the stage its
        // server reports live.
        const activeConfirmed =
          drop.source === 'scatter'
            ? stageLiveAt(stage, blockMs)
            : active?.uuid === arm.stageUuid && activeLive
        if (!activeConfirmed) {
          updateTask(taskId, { arm: null })
          clearArmState(taskId)
          toast.error(
            'The stage did not confirm as open. Check the collection again.'
          )
          return
        }
        // The retries spent, and OpenSea now reports the armed stage live:
        // fall back to the old gate and let the rows report any send failure.
      }

      const armNow = scoped.get().tasks.find((entry) => entry.id === taskId)
      if (!armNow?.arm || armNow.arm.stageUuid !== arm.stageUuid) return

      const preparedForCommit = ready
        ? {
            key: prepareKeyFor(latest, quantity),
            entries: readiness.entries,
          }
        : undefined

      updateTask(taskId, { arm: null })
      clearArmState(taskId)
      await startMint(latest, {
        prepared: checked.check,
        drop,
        stageVerified: ready,
        preparedMint: preparedForCommit,
      })
    } catch (error) {
      toast.error(toMessage(error))
    } finally {
      firingRef.delete(taskId)
    }
  }

  const armedCount = tasks.filter((task) => task.arm !== null).length
  const needsClock =
    armedCount > 0 || tasks.some((task) => task.checked && task.drop !== null)

  useEffect(() => {
    if (!needsClock) return
    const period = armedCount > 0 ? 1000 : 10000
    const timer = window.setInterval(() => setNowMs(Date.now()), period)
    return () => window.clearInterval(timer)
  }, [needsClock, armedCount])

  // Start and the stage window read the selected drop's chain clock. The arm
  // loop publishes its own sample every tick; an unarmed task gets the same
  // reading here, so a fast or slow desktop clock cannot open or close a stage.
  const clockChain = active.drop?.chain ?? null
  useEffect(() => {
    if (clockChain === null) return
    let cancelled = false
    const sample = async () => {
      try {
        const ms = await chainTime(clockChain)
        if (!cancelled) {
          publishChainSample({ ms, at: Date.now(), chain: clockChain })
        }
      } catch {
        if (!cancelled) forgetChainSample(clockChain)
      }
    }
    void sample()
    const timer = window.setInterval(() => void sample(), 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [clockChain])

  const armSignature = tasks
    .flatMap((task) =>
      task.arm
        ? [`${task.id}:${task.arm.stageUuid}:${task.arm.startMs}`]
        : []
    )
    .sort()
    .join('|')

  useEffect(() => {
    // The loop runs from module scope and outlives this page, so it stops when
    // the retained store no longer holds the arm, not when the route unmounts.
    // The callbacks read the store each time; a remount hands over equivalent
    // ones without restarting the loop.
    syncArmLoops({
      tasks: () => scoped.get().tasks,
      prepare: prepareArmed,
      open: openArmed,
      disarm: (taskId, message) => {
        updateTask(taskId, { arm: null })
        toast.error(message)
      },
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [armSignature])

  const view = useMemo(
    () =>
      taskView({
        task: active,
        rows: runs[active.id] ?? [],
        runningIds,
        knownWalletIds,
        locked,
        nowMs,
        blockSample,
      }),
    [active, runs, runningIds, knownWalletIds, locked, nowMs, blockSample]
  )

  const stageStatus = (run: WalletRun): RunStatus =>
    stageStatusFor(run, active.stageUuid, view.stageNotOpen)

  return {
    tasks,
    activeId: realActive?.id ?? null,
    setActiveId,
    active,
    locked,
    items,
    runningIds,
    groups,
    walletsLoading,
    walletsError,
    canPickWallets,
    hasUrl,
    view,
    stageStatus,
    updateActive,
    addTask,
    closeTask,
    changeUrl,
    changeTokenId,
    setWallets,
    selectStage,
    check,
    startMint,
    stopMint,
    armStage,
    disarmStage,
  }
}
