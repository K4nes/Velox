import { useEffect, useMemo, useState } from 'react'
import { useHoldingsScan } from '@/hooks/use-holdings-scan'
import { useWalletGroups } from '@/hooks/use-wallets'
import type { HeldToken } from '@/lib/holdings'
import { probeStandards } from '@/lib/token-standard'
import type { StandardProbe } from '@/lib/token-standard'
import { selectedTransfers } from '@/lib/transfer-plan'
import type { TransferSelection } from '@/lib/transfer-plan'

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

function shortContract(contract: string): string {
  return contract.length > 12
    ? `${contract.slice(0, 6)}…${contract.slice(-4)}`
    : contract
}

export function useTransferScan() {
  const scan = useHoldingsScan()
  const { groups } = useWalletGroups()
  const [probeState, setProbeState] = useState<{
    key: string
    probes: ReadonlyMap<string, StandardProbe>
  }>({ key: '', probes: NO_PROBES })
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([])
  const [sent, setSent] = useState<ReadonlyMap<string, number>>(new Map())

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
    })
      .then((probes) => {
        if (!cancelled) setProbeState({ key: scanKey, probes })
      })
      .catch(() => {
        if (!cancelled) setProbeState({ key: scanKey, probes: NO_PROBES })
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
        const remaining = Math.floor(token.quantity) - (sent.get(token.key) ?? 0)

        let blockedReason: string | null = null
        if (remaining < 1) {
          blockedReason = 'This token has already been transferred'
        } else if (!probe) {
          blockedReason = 'Checking this token…'
        } else if (
          probe.status === 'unsupported' ||
          probe.status === 'unreadable'
        ) {
          blockedReason = 'This token cannot be transferred'
        }

        return { token, selectable: blockedReason === null, blockedReason }
      }),
    [scan.rows, standards, sent]
  )

  const selection = useMemo<TransferSelection[]>(
    () => selectedTransfers({ tokens, standards, sent, selectedKeys }),
    [tokens, standards, sent, selectedKeys]
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
          shortContract(entry.contract),
        imageUrl: collection?.imageUrl ?? '',
        tokens: [token],
      })
    }

    return [...byContract.values()]
  }, [selection, collection])

  function resetSelection() {
    setSelectedKeys([])
    setSent(new Map())
  }

  function toggleToken(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key]
    )
  }

  function toggleAll() {
    const visible = rows
      .filter((row) => row.selectable)
      .map((row) => row.token.key)

    if (
      visible.length > 0 &&
      visible.every((key) => selectedKeys.includes(key))
    ) {
      setSelectedKeys((current) => current.filter((key) => !visible.includes(key)))
      return
    }

    setSelectedKeys((current) => [...new Set([...current, ...visible])])
  }

  function removeToken(key: string) {
    setSelectedKeys((current) => current.filter((value) => value !== key))
  }

  function removeGroup(contract: string) {
    const target = contract.toLowerCase()
    deselect(
      selection
        .filter((entry) => entry.contract.toLowerCase() === target)
        .map((entry) => entry.key)
    )
  }

  function deselect(keys: readonly string[]) {
    setSelectedKeys((current) => current.filter((key) => !keys.includes(key)))
  }

  function applySent(units: Map<string, number>) {
    setSent((current) => {
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
    selectedKeys,
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
    toggleToken,
    toggleAll,
    removeToken,
    removeGroup,
    deselect,
    applySent,
    scan: rescan,
  }
}
