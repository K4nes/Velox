import { useEffect, useMemo, useState } from 'react'
import { useHoldingsScan } from '@/hooks/scan/use-holdings-scan'
import { useSelection } from '@/hooks/use-selection'
import { useWalletGroups } from '@/hooks/use-wallets'
import { shortAddress } from '@/lib/core/format'
import type { HeldToken } from '@/lib/inventory/holdings'
import { probeStandards } from '@/lib/chain/token-standard'
import type { StandardProbe } from '@/lib/chain/token-standard'
import { selectedTransfers } from '@/lib/transfer/transfer-plan'
import type { TransferSelection } from '@/lib/transfer/transfer-plan'

export type TransferScanRow = {
  token: HeldToken
  selectable: boolean
  blockedReason: string | null
}

export type TransferScanWallet = { id: string; label: string; address: string }

export type TransferSelectionGroup = {
  contract: string
  name: string
  imageUrl: string
  tokens: { key: string; tokenId: string; ownerLabel: string }[]
}

const NO_PROBES: ReadonlyMap<string, StandardProbe> = new Map()

export function useTransferScan() {
  const scan = useHoldingsScan()
  const { groups } = useWalletGroups()
  const [probeState, setProbeState] = useState<{
    key: string
    probes: ReadonlyMap<string, StandardProbe>
  }>({ key: '', probes: NO_PROBES })
  const [spent, setSpent] = useState<ReadonlyMap<string, number>>(new Map())

  const state = scan.state
  const tokens = scan.tokens
  const collection = state.status === 'ready' ? state.collection : null
  // A probe belongs to the collection it was made for. Keying the state keeps a
  // rescan from reusing the previous collection's probes.
  const scanKey =
    state.status === 'ready'
      ? `${state.collection.chain}:${state.collection.slug}`
      : ''
  const standards = probeState.key === scanKey ? probeState.probes : NO_PROBES

  useEffect(() => {
    if (state.status !== 'ready') return

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
      if (!cancelled) setProbeState({ key: scanKey, probes })
    })

    return () => {
      cancelled = true
    }
  }, [state, tokens, scanKey])

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
        const used = spent.get(token.key) ?? 0
        const remaining = Math.floor(token.quantity) - used

        // A spent token is blocked by the ledger even when the chain has not
        // caught up yet, so the same row cannot be queued twice.
        let blockedReason: string | null = null
        if (remaining < 1) {
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

        return { token, selectable: blockedReason === null, blockedReason }
      }),
    [scan.rows, standards, spent]
  )

  const select = useSelection(rows, {
    keyOf: (row) => row.token.key,
    isSelectable: (row) => row.selectable,
  })

  const selection = useMemo<TransferSelection[]>(
    () =>
      selectedTransfers({
        tokens,
        standards,
        spent,
        selectedKeys: select.selectedKeys,
      }),
    [tokens, standards, spent, select.selectedKeys]
  )

  const selectionGroups = useMemo<TransferSelectionGroup[]>(() => {
    const byContract = new Map<string, TransferSelectionGroup>()

    for (const entry of selection) {
      const contract = entry.contract.toLowerCase()
      const token = {
        key: entry.key,
        tokenId: entry.tokenId,
        ownerLabel: entry.from.label,
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

  function resetSelection() {
    select.setKeys([])
    setSpent(new Map())
  }

  function removeToken(key: string) {
    select.deselect([key])
  }

  function removeGroup(contract: string) {
    const target = contract.toLowerCase()
    select.deselect(
      selection
        .filter((entry) => entry.contract.toLowerCase() === target)
        .map((entry) => entry.key)
    )
  }

  function applySpent(units: Map<string, number>) {
    setSpent((current) => {
      const next = new Map(current)
      for (const [key, amount] of units) {
        next.set(key, (next.get(key) ?? 0) + amount)
      }
      return next
    })
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
    changeUrl: (next: string) => {
      if (scan.running) return
      resetSelection()
      scan.changeUrl(next)
    },
    changeWallets: (ids: string[]) => {
      if (scan.running) return
      resetSelection()
      scan.changeWallets(ids)
    },
    toggleToken: select.toggle,
    toggleAll: select.toggleAll,
    removeToken,
    removeGroup,
    deselect: select.deselect,
    applySpent,
    scan: rescan,
  }
}
