import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useWalletGroups } from '@/hooks/use-wallets'
import { ARM_TICK_MS, armWait } from '@/lib/arm-schedule'
import { mapLimit } from '@/lib/core/async'
import { RpcConfigError } from '@/lib/chain/connections'
import {
  checkWalletEligibility,
  getEligibilityToken,
} from '@/lib/eligibility'
import { cachedEligibilityToken } from '@/lib/eligibility-token-cache'
import { mintFailureMessage, toMessage } from '@/lib/core/error-message'
import { traceMint } from '@/lib/mint-trace'
import { mintForWallet } from '@/lib/mint'
import {
  callTransaction,
  chainTime,
  estimateGasFor,
  waitForReceipt,
  WALLET_CONCURRENCY,
} from '@/lib/chain/tx'
import {
  createTask,
  gweiToWei,
  initialQuantity,
  landed,
  mergeCheckedRows,
  mintableRow,
  placeholderTask,
  quantityCeiling,
  quantityMaxFor,
  reachedChain,
  rowsFromCheck,
  stageStatusFor,
  taskView,
} from '@/lib/mint-task'
import type {
  CheckResult,
  RunStatus,
  Task,
  TaskListItem,
  TaskPatch,
  WalletRun,
} from '@/lib/mint-task'
import {
  buildMintTransaction,
  getDrop,
  slugFromUrl,
} from '@/lib/opensea'
import type { DropInfo, DropStage, MintTransaction } from '@/lib/opensea'
import { listWallets } from '@/lib/wallet/wallets'
import type { StoredWallet } from '@/lib/wallet/wallets'

type PreparedMintEntry = {
  walletId: string
  from: `0x${string}`
  transaction: MintTransaction
  gasLimit?: bigint
}

type PreparedMint = {
  key: string
  entries: PreparedMintEntry[]
}

type Readiness = {
  candidates: number
  entries: PreparedMintEntry[]
}

const READINESS_FALLBACK_ATTEMPTS = 4

export function useMintTasks() {
  const [tasks, setTasks] = useState<Task[]>(() => [createTask()])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, WalletRun[]>>({})
  const [runningIds, setRunningIds] = useState<string[]>([])
  const runsRef = useRef(new Map<string, number>())
  const mintRunRef = useRef(new Map<string, number>())
  const mintingRef = useRef(new Set<string>())
  const firingRef = useRef(new Set<string>())
  const preparedMintRef = useRef(new Map<string, PreparedMint>())
  const prepareAttemptRef = useRef(new Map<string, string>())
  const preparingRef = useRef(new Set<string>())
  const prepareTaskRef = useRef(new Map<string, Promise<void>>())
  const readinessFailuresRef = useRef(new Map<string, number>())
  const openCheckRef = useRef(
    new Map<string, { key: string; check: CheckResult }>()
  )
  // The countdown renders from a local tick, but the fire decision comes from the
  // chain's clock: a desktop that is a minute off would mint before the stage opens.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [blockSample, setBlockSample] = useState<{ ms: number; at: number } | null>(
    null
  )
  const tasksRef = useRef(tasks)
  const runsStateRef = useRef(runs)
  useLayoutEffect(() => {
    tasksRef.current = tasks
  }, [tasks])
  useLayoutEffect(() => {
    runsStateRef.current = runs
  }, [runs])
  const { groups, loading: walletsLoading, error: walletsError } = useWalletGroups()
  const knownWalletIds = useMemo(
    () =>
      new Set(groups.flatMap((group) => group.wallets.map((wallet) => wallet.id))),
    [groups]
  )

  const realActive = tasks.find((task) => task.id === activeId) ?? tasks[0] ?? null
  const active = realActive ?? placeholderTask
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
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task))
    )
  }

  function updateActive(patch: TaskPatch) {
    if (!realActive) return
    updateTask(realActive.id, patch)
  }

  function cancelRun(id: string) {
    runsRef.current.set(id, (runsRef.current.get(id) ?? 0) + 1)
  }

  function cancelMint(id: string) {
    mintRunRef.current.set(id, (mintRunRef.current.get(id) ?? 0) + 1)
  }

  function finishMint(id: string) {
    mintingRef.current.delete(id)
    setRunningIds((current) => current.filter((value) => value !== id))
  }

  function clearArmState(id: string) {
    preparedMintRef.current.delete(id)
    prepareAttemptRef.current.delete(id)
    prepareTaskRef.current.delete(id)
    readinessFailuresRef.current.delete(id)
    openCheckRef.current.delete(id)
  }

  function addTask() {
    const task = createTask()
    setTasks((current) => [...current, task])
    setActiveId(task.id)
  }

  function closeTask(id: string) {
    // The loop is still suspended in an await, and closing would throw away the
    // hash of a transaction that already reached the chain.
    if (mintingRef.current.has(id)) return

    const index = tasks.findIndex((task) => task.id === id)
    if (index === -1) return

    cancelRun(id)
    cancelMint(id)
    finishMint(id)
    clearArmState(id)
    runsRef.current.delete(id)
    mintRunRef.current.delete(id)
    setRuns((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })

    const remaining = tasks.filter((task) => task.id !== id)

    setTasks(remaining)
    if (realActive?.id === id) {
      const neighbour = remaining[index] ?? remaining[index - 1] ?? null
      setActiveId(neighbour ? neighbour.id : null)
    }
  }

  function changeUrl(url: string) {
    if (!realActive || mintingRef.current.has(realActive.id)) return
    cancelRun(realActive.id)
    clearArmState(realActive.id)
    setRuns((current) => ({
      ...current,
      [realActive.id]: (current[realActive.id] ?? []).filter(landed),
    }))
    updateTask(realActive.id, {
      name: 'Task',
      url,
      status: 'idle',
      checked: false,
      drop: null,
      arm: null,
    })
  }

  function setWallets(ids: string[]) {
    if (!realActive) return
    const id = realActive.id
    cancelRun(id)
    clearArmState(id)
    setRuns((current) => ({
      ...current,
      [id]: (current[id] ?? []).filter(reachedChain),
    }))
    updateTask(id, {
      wallets: ids,
      status: 'idle',
      checked: false,
      drop: null,
      stageUuid: '',
      quantityMax: 0,
      quantity: '1',
      arm: null,
    })
  }

  function selectStage(uuid: string) {
    if (!realActive) return
    clearArmState(realActive.id)
    const max = quantityMaxFor(runs[realActive.id] ?? [], realActive.wallets, uuid)
    const stage = realActive.drop?.stages.find((entry) => entry.uuid === uuid) ?? null
    updateTask(realActive.id, {
      stageUuid: uuid,
      quantityMax: max,
      arm: null,
      quantity: initialQuantity(max, stage),
    })
  }

  async function check(
    target?: Task,
    dropOverride?: DropInfo
  ): Promise<CheckResult | null> {
    const task = target ?? realActive
    if (!task || task.status === 'running' || task.url.trim().length === 0) {
      return null
    }
    if (mintingRef.current.has(task.id)) return null

    const id = task.id
    const url = task.url
    const walletIds = [...task.wallets]
    const run = (runsRef.current.get(id) ?? 0) + 1
    runsRef.current.set(id, run)
    updateTask(id, { status: 'running', checked: false })

    const stale = () => runsRef.current.get(id) !== run
    const slug = slugFromUrl(url)

    if (!slug) {
      updateTask(id, {
        name: 'Task',
        status: 'failed',
        checked: false,
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
        drop = await getDrop(slug)
        if (stale()) return null
      }

      if (drop.dropType !== 'seadrop_v1_erc721') {
        updateTask(id, {
          status: 'failed',
          checked: false,
          drop: null,
        })
        toast.error('Only SeaDrop ERC-721 drops are supported')
        return null
      }

      step = 'eligibility'
      // The same key can live in two folders, and one address must not appear
      // as two rows in a batch.
      const byAddress = new Map<string, StoredWallet>()
      for (const wallet of await listWallets()) {
        if (!walletIds.includes(wallet.id)) continue
        const key = wallet.address.toLowerCase()
        if (!byAddress.has(key)) {
          byAddress.set(key, wallet)
        }
      }
      const selected = [...byAddress.values()]
      if (stale()) return null

      if (selected.length === 0) {
        updateTask(id, {
          status: 'failed',
          checked: false,
          drop: null,
        })
        toast.error('Select at least one wallet')
        return null
      }

      const rows = await checkWalletEligibility(drop, selected)
      if (stale()) return null

      // The operator can pick a stage while the check runs. Read the live task,
      // not the snapshot taken when the check started, or that pick is reverted.
      const live = tasksRef.current.find((entry) => entry.id === id) ?? task
      const keptStage = drop.stages.some((entry) => entry.uuid === live.stageUuid)
      const stageUuid = keptStage ? live.stageUuid : (drop.activeStage?.uuid ?? '')
      const stage = drop.stages.find((entry) => entry.uuid === stageUuid) ?? null
      const checkedRows = rowsFromCheck(rows, stageUuid)
      const mergedRows = mergeCheckedRows(checkedRows, runsStateRef.current[id] ?? [])
      const quantityMax = quantityMaxFor(mergedRows, live.wallets, stageUuid)

      setRuns((current) => ({ ...current, [id]: mergedRows }))
      updateTask(id, {
        name: drop.name || slug,
        status: 'idle',
        checked: true,
        drop,
        stageUuid,
        quantityMax,
        quantity: initialQuantity(quantityMax, stage),
      })
      checked = true
      return { drop, rows: mergedRows, quantityMax }
    } catch (error) {
      if (stale()) return null
      updateTask(id, {
        status: 'failed',
        checked: false,
        drop: null,
      })
      toast.error(mintFailureMessage(error, step))
      return null
    } finally {
      traceMint({ kind: 'check-end', taskId: id, ok: checked })
    }
  }

  const mintQuantityFor = (
    task: Task,
    walletMax: number,
    stage: DropStage | null
  ): number | null => {
    const ceiling = quantityCeiling(walletMax, stage)
    const requested = Number.parseInt(task.quantity, 10)
    const quantity = ceiling > 0 ? Math.min(requested, ceiling) : requested
    return Number.isFinite(quantity) && quantity >= 1 ? quantity : null
  }

  // Everything that must match for prepared calldata to still describe this
  // fire. A stage or quantity change rebuilds rather than signing stale data.
  const prepareKeyFor = (task: Task, quantity: number): string =>
    [
      task.stageUuid,
      quantity,
      task.gasLimit,
      task.maxFee,
      task.priorityFee,
    ].join('|')

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
    if (!task || !task.drop || mintingRef.current.has(task.id)) return

    const id = task.id
    const drop = options.drop ?? prepared?.drop ?? task.drop
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

    const preparedEntries =
      options.preparedMint?.key === prepareKeyFor(task, quantity)
        ? new Map(
            options.preparedMint.entries.map((entry) => [
              entry.walletId,
              entry,
            ])
          )
        : null

    mintingRef.current.add(id)
    setRunningIds((current) => [...current, id])
    const run = (mintRunRef.current.get(id) ?? 0) + 1
    mintRunRef.current.set(id, run)
    const stopped = () => mintRunRef.current.get(id) !== run

    try {
      const fresh = options.drop ?? (await getDrop(drop.slug))
      if (stopped()) return
      if (!options.stageVerified && fresh.activeStage === null) {
        setRuns((current) => ({
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

      // The endpoint sends only minter and quantity, so it mints the live stage
      // whatever the picker says. Sending a batch built from another stage would
      // mint A for wallets counted against B, and the doomed retry would wipe the
      // record of a transaction that already landed.
      const liveStageUuid = options.stageVerified
        ? task.stageUuid
        : (fresh.activeStage?.uuid ?? '')
      if (!options.stageVerified && liveStageUuid !== task.stageUuid) {
        updateTask(id, { checked: false })
        toast.error('The live stage changed. Check the collection again.')
        return
      }

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

      setRuns((current) => ({
        ...current,
        [id]: (current[id] ?? []).map((row) =>
          mintable.has(row.walletId)
            ? {
                ...row,
                status: 'queued' as const,
                txHash: undefined,
                chain: undefined,
                error: undefined,
              }
            : row
        ),
      }))

      const updateRun = (
        walletId: string,
        patch: (row: WalletRun) => Partial<WalletRun>
      ) => {
        if (stopped()) return
        setRuns((current) => ({
          ...current,
          [id]: (current[id] ?? []).map((entry) =>
            entry.walletId === walletId ? { ...entry, ...patch(entry) } : entry
          ),
        }))
      }

      const broadcast: { walletId: string; chain: string; txHash: string }[] = []

      // Two wallets at a time, handed out in wallet-list order so wallet 0 is
      // in the first pair.
      await mapLimit(selected, WALLET_CONCURRENCY, async (wallet) => {
        if (stopped()) return
        updateRun(wallet.id, () => ({ status: 'minting' }))
        const preparedEntry = preparedEntries?.get(wallet.id)
        try {
          const result = await mintForWallet({
            slug: drop.slug,
            wallet,
            quantity,
            gas: preparedEntry?.gasLimit
              ? { ...gas, gasLimit: preparedEntry.gasLimit }
              : gas,
            transaction: preparedEntry?.transaction,
            shouldAbort: stopped,
          })
          if (stopped()) return
          updateRun(wallet.id, (row) => ({
            status: 'broadcast',
            txHash: result.txHash,
            chain: result.chain,
            mintedStages: [...row.mintedStages, liveStageUuid],
          }))
          broadcast.push({
            walletId: wallet.id,
            chain: result.chain,
            txHash: result.txHash,
          })
        } catch (error) {
          if (stopped()) return
          updateRun(wallet.id, () => ({
            status: 'failed',
            error: toMessage(error),
          }))
        }
      })

      // Receipts are independent reads, so they can outrun the send cap.
      await mapLimit(broadcast, 4, async (entry) => {
        if (stopped()) return
        try {
          const status = await waitForReceipt(entry.chain, entry.txHash)
          updateRun(entry.walletId, () =>
            status === 'success'
              ? { status: 'confirmed' }
              : { status: 'failed', error: 'Transaction reverted' }
          )
        } catch (error) {
          updateRun(entry.walletId, () => ({
            error: toMessage(error),
          }))
        }
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
    if (!realActive || !active.drop) return
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

  // Live OpenSea answers 409 NOT_MINTING before a stage opens, so this open-time
  // batch is the real path. It builds every mintable wallet's calldata in one
  // round trip, then the commit reuses those entries instead of fetching again.
  async function readinessForRows(
    task: Task,
    drop: DropInfo,
    quantity: number,
    rows: WalletRun[],
    preparedMint?: PreparedMint
  ): Promise<Readiness> {
    const mintable = rows.filter(
      (row) =>
        task.wallets.includes(row.walletId) &&
        mintableRow(row, task.stageUuid)
    )
    const prepared =
      preparedMint?.key === prepareKeyFor(task, quantity)
        ? new Map(
            preparedMint.entries.map((entry) => [entry.walletId, entry])
          )
        : null
    const entries = await Promise.all(
      mintable.map(async (row) => {
        const cached = prepared?.get(row.walletId)
        if (cached) return cached
        try {
          const transaction = await buildMintTransaction(
            drop.slug,
            row.address,
            quantity
          )
          return {
            walletId: row.walletId,
            from: row.address as `0x${string}`,
            transaction,
          }
        } catch {
          return null
        }
      })
    )
    return {
      candidates: mintable.length,
      entries: entries.filter(
        (entry): entry is PreparedMintEntry => entry !== null
      ),
    }
  }

  async function stageReady(
    chainSlug: string,
    entries: PreparedMintEntry[]
  ): Promise<boolean> {
    // No calldata means no evidence. The caller retries with backoff instead of
    // treating a failed build as a successful readiness check.
    if (entries.length === 0) return false
    const results = await Promise.allSettled(
      entries.map((entry) =>
        callTransaction({
          chainSlug,
          from: entry.from,
          to: entry.transaction.to as `0x${string}`,
          data: entry.transaction.data as `0x${string}`,
          value: BigInt(entry.transaction.value),
        })
      )
    )
    return results.some((result) => result.status === 'fulfilled')
  }

  async function prepareArmed(
    taskId: string,
    arm: { stageUuid: string; startMs: number }
  ): Promise<void> {
    // openArmed owns calldata once it starts firing. A prepare racing it would
    // issue a second /mint request and break the single open-time fetch.
    if (firingRef.current.has(taskId)) return
    const task = tasksRef.current.find((entry) => entry.id === taskId)
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
    if (preparedMintRef.current.get(taskId)?.key === key) return
    if (prepareAttemptRef.current.get(taskId) === key) return
    if (preparingRef.current.has(taskId)) return
    prepareAttemptRef.current.set(taskId, key)
    preparingRef.current.add(taskId)

    try {
      const mintable = new Set(
        (runsStateRef.current[taskId] ?? [])
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

      const gasLimitInput = Number.parseInt(task.gasLimit, 10)
      const pinnedGasLimit =
        Number.isFinite(gasLimitInput) && gasLimitInput > 0
          ? BigInt(gasLimitInput)
          : undefined
      const entries: PreparedMintEntry[] = []

      for (const wallet of selected) {
        const current = tasksRef.current.find((entry) => entry.id === taskId)
        if (
          !current?.arm ||
          current.arm.stageUuid !== arm.stageUuid ||
          current.arm.startMs !== arm.startMs
        ) {
          return
        }

        try {
          await cachedEligibilityToken(wallet.address, () =>
            getEligibilityToken(wallet.privateKey)
          )
        } catch {
          // The check retries a sign-in; a failed warm must not fail prepare.
        }

        try {
          // Measured 2026-11-09: live OpenSea answers 409 NOT_MINTING to this
          // endpoint before a stage opens. This stays best-effort for providers
          // that do answer; openArmed builds the same calldata at the open when
          // it does not.
          const transaction = await buildMintTransaction(
            task.drop.slug,
            wallet.address,
            quantity
          )
          let gasLimit = pinnedGasLimit
          if (gasLimit === undefined) {
            try {
              gasLimit = await estimateGasFor({
                wallet,
                chainSlug: transaction.chain,
                to: transaction.to as `0x${string}`,
                data: transaction.data as `0x${string}`,
                value: BigInt(transaction.value),
              })
            } catch {
              // The stage is still closed, so the commit estimates again.
            }
          }
          entries.push({
            walletId: wallet.id,
            from: wallet.address as `0x${string}`,
            transaction,
            gasLimit,
          })
        } catch {
          // Missing calldata falls back to the commit path.
        }
      }

      const current = tasksRef.current.find((entry) => entry.id === taskId)
      if (
        !current?.arm ||
        current.arm.stageUuid !== arm.stageUuid ||
        current.arm.startMs !== arm.startMs
      ) {
        return
      }
      preparedMintRef.current.set(taskId, {
        key: prepareKeyFor(current, quantity),
        entries,
      })
    } catch {
      // Best-effort: openArmed and the commit rebuild what is missing.
    } finally {
      preparingRef.current.delete(taskId)
    }
  }

  async function openArmed(taskId: string, blockMs: number) {
    const task = tasksRef.current.find((entry) => entry.id === taskId)
    const arm = task?.arm
    if (!task || !arm || !task.drop || firingRef.current.has(taskId)) return
    firingRef.current.add(taskId)
    const armKey = `${taskId}:${arm.stageUuid}:${arm.startMs}`
    try {
      // A prepare started just before the open can still be in flight. Let it
      // settle so readiness reuses its calldata instead of fetching a second
      // copy.
      const pendingPrepare = prepareTaskRef.current.get(taskId)
      if (pendingPrepare) await pendingPrepare
      const drop = await getDrop(task.drop.slug)
      // The operator can disarm, or arm a different stage, while the drop is in
      // flight. Re-read before acting, or a cancelled run still spends gas.
      const latest = tasksRef.current.find((entry) => entry.id === taskId)
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
      // stage change. A stale one whose window has closed does not block the
      // scheduled fire; the calldata check below is the authority on the open.
      const active = drop.activeStage
      const activeStart = active?.startTime ? Date.parse(active.startTime) : NaN
      const activeEnd = active?.endTime ? Date.parse(active.endTime) : NaN
      const activeLive =
        active !== null &&
        (!Number.isFinite(activeStart) || activeStart <= blockMs) &&
        (!Number.isFinite(activeEnd) || blockMs < activeEnd)
      if (active && active.uuid !== arm.stageUuid && activeLive) {
        toast.error('The live stage changed. Check the collection again.')
        return
      }

      // A check that started while the drop was in flight owns the task now; the
      // next tick retries with the arm intact.
      if (latest.status === 'running') return

      // Caps can appear only when the stage opens, so readiness must start from
      // the rows of an open-time check, not the pre-open ones. Keep that check
      // across readiness retries instead of re-running eligibility every tick.
      let checked = openCheckRef.current.get(taskId)
      if (checked?.key !== armKey) {
        const result = await check(latest, drop)
        if (!result) {
          updateTask(taskId, { arm: null })
          clearArmState(taskId)
          return
        }
        checked = { key: armKey, check: result }
        openCheckRef.current.set(taskId, checked)
      }

      const current = tasksRef.current.find((entry) => entry.id === taskId)
      if (!current?.arm || current.arm.stageUuid !== arm.stageUuid) return
      const quantity = mintQuantityFor(latest, checked.check.quantityMax, stage)
      if (quantity === null) {
        updateTask(taskId, { arm: null })
        clearArmState(taskId)
        toast.error('Quantity must be at least 1')
        return
      }

      const readiness = await readinessForRows(
        latest,
        checked.check.drop,
        quantity,
        checked.check.rows,
        preparedMintRef.current.get(taskId)
      )
      if (readiness.candidates === 0) {
        updateTask(taskId, { arm: null })
        clearArmState(taskId)
        toast.error('No wallet can mint this stage')
        return
      }

      const ready = await stageReady(drop.chain, readiness.entries)
      if (!ready) {
        const failures = (readinessFailuresRef.current.get(taskId) ?? 0) + 1
        readinessFailuresRef.current.set(taskId, failures)
        // Calldata that failed at the open must not be reused on every retry.
        preparedMintRef.current.delete(taskId)
        prepareAttemptRef.current.delete(taskId)
        if (failures < READINESS_FALLBACK_ATTEMPTS) return

        const activeConfirmed = active?.uuid === arm.stageUuid && activeLive
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

      const armNow = tasksRef.current.find((entry) => entry.id === taskId)
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
      firingRef.current.delete(taskId)
    }
  }

  const armedCount = tasks.filter((task) => task.arm !== null).length
  const needsClock =
    armedCount > 0 || tasks.some((task) => task.checked && task.drop !== null)

  const openArmedRef = useRef(openArmed)
  useEffect(() => {
    openArmedRef.current = openArmed
  })
  const prepareArmedRef = useRef(prepareArmed)
  useEffect(() => {
    prepareArmedRef.current = prepareArmed
  })

  useEffect(() => {
    if (!needsClock) return
    const period = armedCount > 0 ? 1000 : 10000
    const timer = window.setInterval(() => setNowMs(Date.now()), period)
    return () => window.clearInterval(timer)
  }, [needsClock, armedCount])

  const armSignature = tasks
    .flatMap((task) =>
      task.arm
        ? [`${task.id}:${task.arm.stageUuid}:${task.arm.startMs}`]
        : []
    )
    .sort()
    .join('|')

  useEffect(() => {
    if (armSignature === '') return
    let cancelled = false
    const timers = new Set<number>()

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          resolve()
        }, ms)
        timers.add(timer)
      })

    const sampleChain = async (task: Task, chain: string) => {
      const ms = await chainTime(chain)
      if (cancelled) return null
      traceMint({ kind: 'poll', taskId: task.id, chainMs: ms })
      setBlockSample({ ms, at: Date.now() })
      return ms
    }

    const disarmTask = (taskId: string, message: string) => {
      updateTask(taskId, { arm: null })
      toast.error(message)
    }

    const runArm = async (taskId: string) => {
      // One offset for the whole arm. The chain's whole-second timestamps make
      // the local target approximate, which the tight window resolves.
      let offsetMs: number | null = null
      let postOpenDelay = 1_000
      let openReached = false

      while (!cancelled) {
        const task = tasksRef.current.find((entry) => entry.id === taskId)
        const arm = task?.arm
        if (!task || !arm) return
        if (task.status === 'running') {
          await sleep(ARM_TICK_MS)
          continue
        }

        const chain = task.drop?.chain
        if (!chain) {
          disarmTask(
            task.id,
            'The scheduled mint was cancelled. Check the collection again.'
          )
          return
        }

        if (offsetMs === null) {
          try {
            const ms = await sampleChain(task, chain)
            if (ms === null) return
            offsetMs = ms - Date.now()
          } catch (error) {
            // A chain with no usable RPC never recovers on its own, so
            // disarming beats a countdown that can never fire.
            if (error instanceof RpcConfigError) {
              disarmTask(task.id, error.message)
              return
            }
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
          !firingRef.current.has(task.id) &&
          !prepareTaskRef.current.has(task.id)
        ) {
          const running = prepareArmedRef.current(task.id, arm)
          prepareTaskRef.current.set(task.id, running)
          const finished = () => {
            if (prepareTaskRef.current.get(task.id) === running) {
              prepareTaskRef.current.delete(task.id)
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
          const ms = await sampleChain(task, chain)
          if (ms === null) return
          if (ms >= arm.startMs) {
            openReached = true
            await openArmedRef.current(task.id, ms)
            if (cancelled) return
            const latest = tasksRef.current.find(
              (entry) => entry.id === taskId
            )
            if (!latest?.arm) return
            // Past the open, a failed readiness check must not become four
            // provider round trips a second. Ramp 1s -> 2s -> 4s, cap there.
            await sleep(postOpenDelay)
            postOpenDelay = Math.min(postOpenDelay * 2, 4_000)
            continue
          }
        } catch (error) {
          // An RPC hiccup must not disarm anything; the next tick retries.
          if (error instanceof RpcConfigError) {
            disarmTask(task.id, error.message)
            return
          }
        }
        await sleep(Math.max(0, ARM_TICK_MS - (Date.now() - tickStart)))
      }
    }

    for (const task of tasksRef.current) {
      if (task.arm) void runArm(task.id)
    }

    return () => {
      cancelled = true
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
    }
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
    setWallets,
    selectStage,
    check,
    startMint,
    armStage,
    disarmStage,
  }
}
