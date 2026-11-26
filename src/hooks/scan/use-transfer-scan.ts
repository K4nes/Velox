import { useEffect, useMemo } from 'react'
import { usePageStore, usePageStoreScope } from '@/hooks/use-page-store'
import { useHoldingsScan } from '@/hooks/scan/use-holdings-scan'
import { useSelection } from '@/hooks/use-selection'
import type { SelectionFields } from '@/hooks/use-selection'
import { useWalletGroups } from '@/hooks/data/use-wallets'
import { EMPTY_HOLDINGS } from '@/lib/inventory/holdings-fields'
import type { HoldingsFields } from '@/lib/inventory/holdings-fields'
import type { PageStore } from '@/lib/core/page-store'
import { shortAddress } from '@/lib/core/format'
import type { HeldToken } from '@/lib/inventory/holdings'
import { probeStandards } from '@/lib/chain/token-standard'
import type {
  StandardProbe,
  TokenStandard,
} from '@/lib/chain/token-standard'
import {
  clampTransferAmount,
  selectedTransfers,
} from '@/lib/transfer/transfer-plan'
import type { TransferSelection } from '@/lib/transfer/transfer-plan'
import { chainBySlug } from '@/config/chains'

export type TransferScanRow = {
  token: HeldToken
  standard: TokenStandard | null
  available: number
  amount: number
  selectable: boolean
  blockedReason: string | null
}

export type TransferScanWallet = { id: string; label: string; address: string }

export type TransferSelectionGroup = {
  contract: string
  name: string
  imageUrl: string
  tokens: {
    key: string
    tokenId: string
    ownerLabel: string
    standard: TokenStandard
    amount: number
    available: number
  }[]
}

export type TransferProbeState = {
  key: string
  probes: ReadonlyMap<string, StandardProbe>
}

export type TransferScanFields = HoldingsFields &
  SelectionFields & {
    probeState: TransferProbeState
    spent: ReadonlyMap<string, number>
    amounts: ReadonlyMap<string, number>
  }

const NO_PROBES: ReadonlyMap<string, StandardProbe> = new Map()

const INITIAL: TransferScanFields = {
  ...EMPTY_HOLDINGS,
  selectedKeys: [],
  probeState: { key: '', probes: NO_PROBES },
  spent: new Map(),
  amounts: new Map(),
}

export function useTransferScan(store?: PageStore<TransferScanFields>) {
  const scoped = usePageStoreScope(store, INITIAL)
  const fields = usePageStore(scoped)
  const scan = useHoldingsScan(scoped)
  const { groups } = useWalletGroups()

  const state = fields.state
  const tokens = fields.tokens
  const spent = fields.spent
  const amounts = fields.amounts
  const collection = state.status === 'ready' ? state.collection : null
  // A chain the app cannot reach cannot answer a standard probe. Naming it once
  // at scan level keeps every row from reading as an unreadable token.
  const chainError =
    state.status === 'ready' && !chainBySlug(state.collection.chain)
      ? `Chain not supported: ${state.collection.chain}`
      : null
  const truncated =
    state.status === 'ready' && state.scans.some((scan) => scan.truncated)
  // A probe belongs to the collection it was made for. Keying the state keeps a
  // rescan from reusing the previous collection's probes.
  const scanKey =
    state.status === 'ready'
      ? `${state.collection.chain}:${state.collection.slug}`
      : ''
  const standards =
    fields.probeState.key === scanKey ? fields.probeState.probes : NO_PROBES

  useEffect(() => {
    if (state.status !== 'ready') return
    if (chainError !== null) return

    const byContract = new Map<
      string,
      { contract: string; tokenId: string; owner: string }
    >()
    for (const token of tokens) {
      const key = token.contractAddress.toLowerCase()
      if (byContract.has(key)) continue
      byContract.set(key, {
        contract: token.contractAddress,
        tokenId: token.tokenId,
        owner: token.owner.address,
      })
    }
    if (byContract.size === 0) return

    let cancelled = false
    probeStandards({
      chain: state.collection.chain,
      tokens: [...byContract.values()],
    }).then((probes) => {
      if (!cancelled) scoped.set({ probeState: { key: scanKey, probes } })
    })

    return () => {
      cancelled = true
    }
  }, [state, tokens, scanKey, scoped, chainError])

  const wallets = useMemo<TransferScanWallet[]>(
    () =>
      groups.flatMap((group) =>
        group.wallets.map((wallet) => ({
          id: wallet.id,
          label: wallet.name,
          address: wallet.address,
        }))
      ),
    [groups]
  )

  const rows = useMemo<TransferScanRow[]>(
    () =>
      scan.rows.map((token) => {
        const probe = standards.get(token.contractAddress.toLowerCase())
        const standard =
          probe?.status === 'known' ? probe.standard : null
        const used = spent.get(token.key) ?? 0
        const remaining = Math.floor(token.quantity) - used
        const available = Math.max(0, remaining)
        const amount =
          standard === 'erc1155'
            ? clampTransferAmount(amounts.get(token.key) ?? 1, available, standard)
            : 1

        // A spent token is blocked by the ledger even when the chain has not
        // caught up yet, so the same row cannot be queued twice.
        let blockedReason: string | null = null
        if (chainError !== null) {
          blockedReason = chainError
        } else if (remaining < 1) {
          blockedReason =
            used > 0
              ? 'This token has already been transferred'
              : 'This token has no transferable balance'
        } else if (!probe) {
          blockedReason = 'Checking this token…'
        } else if (probe.status === 'unsupported') {
          blockedReason = 'This token cannot be transferred'
        } else if (probe.status === 'unreadable') {
          blockedReason = 'Could not check this token'
        }

        return {
          token,
          standard,
          available,
          amount,
          selectable: blockedReason === null,
          blockedReason,
        }
      }),
    [scan.rows, standards, spent, amounts, chainError]
  )

  const select = useSelection(
    rows,
    {
      keyOf: (row) => row.token.key,
      isSelectable: (row) => row.selectable,
    },
    scoped
  )

  const selection = useMemo<TransferSelection[]>(
    () =>
      selectedTransfers({
        tokens,
        standards,
        spent,
        selectedKeys: select.selectedKeys,
        amounts,
      }),
    [tokens, standards, spent, select.selectedKeys, amounts]
  )

  const selectionGroups = useMemo<TransferSelectionGroup[]>(() => {
    const byContract = new Map<string, TransferSelectionGroup>()

    for (const entry of selection) {
      const contract = entry.contract.toLowerCase()
      const token = {
        key: entry.key,
        tokenId: entry.tokenId,
        ownerLabel: entry.from.label,
        standard: entry.standard,
        amount: entry.amount,
        available: entry.available,
      }
      const group = byContract.get(contract)
      if (group) {
        group.tokens.push(token)
        continue
      }

      byContract.set(contract, {
        contract: entry.contract,
        name:
          collection?.name ||
          collection?.slug ||
          shortAddress(entry.contract),
        imageUrl: collection?.imageUrl ?? '',
        tokens: [token],
      })
    }

    return [...byContract.values()]
  }, [selection, collection])

  function clearAmounts(keys: readonly string[]) {
    const current = scoped.get().amounts
    const present = keys.filter((key) => current.has(key))
    if (present.length === 0) return

    const next = new Map(current)
    for (const key of present) next.delete(key)
    scoped.set({ amounts: next })
  }

  function clearSelection({ keepSpent = false } = {}) {
    select.setKeys([])
    scoped.set({
      amounts: new Map<string, number>(),
      ...(keepSpent ? {} : { spent: new Map<string, number>() }),
    })
  }

  function deselect(keys: readonly string[]) {
    select.deselect(keys)
    clearAmounts(keys)
  }

  // A successful run keeps its ledger for this collection and wallet scope:
  // OpenSea can lag behind a receipt, and a row that reappears must stay
  // blocked rather than send the same token twice.
  function resetSelection() {
    clearSelection({ keepSpent: true })
  }

  function setAmount(key: string, value: number) {
    const entry = selection.find((row) => row.key === key)
    if (!entry || entry.standard !== 'erc1155') return

    const next = new Map(scoped.get().amounts)
    next.set(key, clampTransferAmount(value, entry.available, entry.standard))
    scoped.set({ amounts: next })
  }

  function toggleToken(key: string) {
    select.toggle(key)
    if (!scoped.get().selectedKeys.includes(key)) clearAmounts([key])
  }

  function toggleAll() {
    const before = scoped.get().selectedKeys
    select.toggleAll()
    const after = scoped.get().selectedKeys
    clearAmounts(before.filter((key) => !after.includes(key)))
  }

  function removeToken(key: string) {
    deselect([key])
  }

  function removeGroup(contract: string) {
    const target = contract.toLowerCase()
    deselect(
      selection
        .filter((entry) => entry.contract.toLowerCase() === target)
        .map((entry) => entry.key)
    )
  }

  function applySpent(units: Map<string, number>) {
    const next = new Map(scoped.get().spent)
    for (const [key, amount] of units) {
      next.set(key, (next.get(key) ?? 0) + amount)
    }
    scoped.set({ spent: next })
  }

  async function rescan() {
    if (scan.running) return
    resetSelection()
    await scan.scan()
  }

  return {
    url: scan.url,
    selectedWallets: scan.selectedWallets,
    state,
    rows,
    totalRows: scan.totalRows,
    query: scan.query,
    setQuery: scan.setQuery,
    running: scan.running,
    canScan: scan.canScan,
    collection,
    groups,
    wallets,
    selectedKeys: select.selectedKeys,
    selection,
    selectionGroups,
    chainError,
    truncated,
    changeUrl: (next: string) => {
      if (scan.running) return
      clearSelection()
      scan.changeUrl(next)
    },
    changeWallets: (ids: string[]) => {
      if (scan.running) return
      clearSelection()
      scan.changeWallets(ids)
    },
    toggleToken,
    toggleAll,
    removeToken,
    removeGroup,
    deselect,
    setAmount,
    applySpent,
    scan: rescan,
  }
}
