import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useWalletGroups } from '@/hooks/use-wallets'
import { RpcConfigError } from '@/lib/connections'
import { checkWalletEligibility } from '@/lib/eligibility'
import { mintFailureMessage, toMessage } from '@/lib/error-message'
import { mintForWallet } from '@/lib/mint'
import { chainTime, waitForReceipt } from '@/lib/tx'
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
import { getCollection, getDrop, slugFromUrl } from '@/lib/opensea'
import { listWallets } from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'

export function useMintTasks() {
  const [tasks, setTasks] = useState<Task[]>(() => [createTask()])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, WalletRun[]>>({})
  const [runningIds, setRunningIds] = useState<string[]>([])
  const runsRef = useRef(new Map<string, number>())
  const mintRunRef = useRef(new Map<string, number>())
  const mintingRef = useRef(new Set<string>())
  const firingRef = useRef(new Set<string>())
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
    const max = quantityMaxFor(runs[realActive.id] ?? [], realActive.wallets, uuid)
    const stage = realActive.drop?.stages.find((entry) => entry.uuid === uuid) ?? null
    updateTask(realActive.id, {
      stageUuid: uuid,
      quantityMax: max,
      arm: null,
      quantity: initialQuantity(max, stage),
    })
  }

  async function check(target?: Task): Promise<CheckResult | null> {
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

    let step: 'collection' | 'drop' | 'eligibility' = 'collection'

    try {
      await getCollection(slug)
      if (stale()) return null

      step = 'drop'
      const drop = await getDrop(slug)
      if (stale()) return null

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
    }
  }

  // `prepared` carries a check that just landed, so an armed run mints from the
  // rows it computed instead of the ones React has not committed yet.
  async function startMint(target?: Task, prepared?: CheckResult) {
    const task = target ?? realActive
    if (!task || !task.drop || mintingRef.current.has(task.id)) return

    const id = task.id
    const drop = prepared?.drop ?? task.drop
    const stage =
      drop.stages.find((entry) => entry.uuid === task.stageUuid) ?? null
    const ceiling = quantityCeiling(
      prepared ? prepared.quantityMax : task.quantityMax,
      stage
    )
    const requested = Number.parseInt(task.quantity, 10)
    const quantity = ceiling > 0 ? Math.min(requested, ceiling) : requested
    const gasLimitInput = Number.parseInt(task.gasLimit, 10)

    if (!Number.isFinite(quantity) || quantity < 1) {
      toast.error('Quantity must be at least 1')
      return
    }

    mintingRef.current.add(id)
    setRunningIds((current) => [...current, id])
    const run = (mintRunRef.current.get(id) ?? 0) + 1
    mintRunRef.current.set(id, run)
    const stopped = () => mintRunRef.current.get(id) !== run

    try {
      const fresh = await getDrop(drop.slug)
      if (stopped()) return
      if (fresh.activeStage === null) {
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

      const liveStageUuid = fresh.activeStage.uuid
      // The endpoint sends only minter and quantity, so it mints the live stage
      // whatever the picker says. Sending a batch built from another stage would
      // mint A for wallets counted against B, and the doomed retry would wipe the
      // record of a transaction that already landed.
      if (liveStageUuid !== task.stageUuid) {
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

      for (const wallet of selected) {
        if (stopped()) break
        updateRun(wallet.id, () => ({ status: 'minting' }))
        try {
          const result = await mintForWallet({
            slug: drop.slug,
            wallet,
            quantity,
            gas,
            shouldAbort: stopped,
          })
          if (stopped()) break
          updateRun(wallet.id, (row) => ({
            status: 'broadcast',
            txHash: result.txHash,
            mintedStages: [...row.mintedStages, liveStageUuid],
          }))
          broadcast.push({
            walletId: wallet.id,
            chain: result.chain,
            txHash: result.txHash,
          })
        } catch (error) {
          if (stopped()) break
          updateRun(wallet.id, () => ({
            status: 'failed',
            error: toMessage(error),
          }))
        }
      }

      for (const entry of broadcast) {
        if (stopped()) break
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
      }
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
    updateTask(realActive.id, { arm: null })
  }

  async function openArmed(taskId: string, blockMs: number) {
    const task = tasksRef.current.find((entry) => entry.id === taskId)
    const arm = task?.arm
    if (!task || !arm || !task.drop || firingRef.current.has(taskId)) return
    firingRef.current.add(taskId)
    try {
      const drop = await getDrop(task.drop.slug)
      // The operator can disarm, or arm a different stage, while the drop is in
      // flight. Re-read before acting, or a cancelled run still spends gas.
      const latest = tasksRef.current.find((entry) => entry.id === taskId)
      if (!latest || latest.arm?.stageUuid !== arm.stageUuid) return
      if (drop.activeStage?.uuid !== arm.stageUuid) {
        // The armed stage never went live. Give up once it is gone or its window
        // has closed, instead of polling OpenSea every four seconds forever.
        const stage = drop.stages.find((entry) => entry.uuid === arm.stageUuid)
        const endMs = stage?.endTime ? Date.parse(stage.endTime) : NaN
        if (!stage || (Number.isFinite(endMs) && blockMs >= endMs)) {
          updateTask(taskId, { arm: null })
          toast.error('The scheduled stage closed before it opened.')
        }
        return
      }
      // A check that started while the drop was in flight owns the task now; the
      // next tick retries with the arm intact.
      if (latest.status === 'running') return
      updateTask(taskId, { arm: null })
      const prepared = await check(latest)
      if (!prepared) return
      await startMint(latest, prepared)
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

  useEffect(() => {
    if (!needsClock) return
    const period = armedCount > 0 ? 1000 : 10000
    const timer = window.setInterval(() => setNowMs(Date.now()), period)
    return () => window.clearInterval(timer)
  }, [needsClock, armedCount])

  useEffect(() => {
    if (armedCount === 0) return
    let cancelled = false

    const poll = async () => {
      for (const task of tasksRef.current) {
        const arm = task.arm
        if (!arm) continue
        if (task.status === 'running') continue
        const chain = task.drop?.chain
        if (!chain) {
          updateTask(task.id, { arm: null })
          toast.error('The scheduled mint was cancelled. Check the collection again.')
          continue
        }
        try {
          const ms = await chainTime(chain)
          if (cancelled) return
          setBlockSample({ ms, at: Date.now() })
          if (ms >= arm.startMs) void openArmedRef.current(task.id, ms)
        } catch (error) {
          // A chain with no usable RPC never recovers on its own, so disarming
          // beats a countdown that can never fire.
          if (error instanceof RpcConfigError) {
            updateTask(task.id, { arm: null })
            toast.error(error.message)
            continue
          }
          // An RPC hiccup must not disarm anything; the next poll retries.
        }
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [armedCount])

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
