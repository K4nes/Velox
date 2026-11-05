import { useEffect, useMemo, useState } from 'react'
import { useHoldingsScan } from '@/hooks/use-holdings-scan'
import { useWalletGroups } from '@/hooks/use-wallets'
import type { HeldToken } from '@/lib/holdings'
import { probeStandards } from '@/lib/token-standard'
import type { StandardProbe, TokenStandard } from '@/lib/token-standard'
import { selectedTransfers } from '@/lib/transfer-plan'
import type { TransferSelection } from '@/lib/transfer-plan'

export type TransferScanRow = {
  token: HeldToken
  standard: TokenStandard | null
  remaining: number
}

export type TransferScanWallet = { id: string; label: string; address: string }

const NO_PROBES: ReadonlyMap<string, StandardProbe> = new Map()

export function useTransferScan() {
  const scan = useHoldingsScan()
  const { groups } = useWalletGroups()
  const [probeState, setProbeState] = useState<{
    key: string
    probes: ReadonlyMap<string, StandardProbe>
  }>({ key: '', probes: NO_PROBES })
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([])
  const [amounts, setAmounts] = useState<ReadonlyMap<string, number>>(new Map())
  const [sent, setSent] = useState<ReadonlyMap<string, number>>(new Map())

  const state = scan.state
  const tokens = scan.tokens
  // A probe belongs to the collection it was made for. Keying the state makes a
  // rescan show "reading" instead of the previous collection's standard.
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
        return {
          token,
          standard: probe?.status === 'known' ? probe.standard : null,
          remaining: Math.floor(token.quantity) - (sent.get(token.key) ?? 0),
        }
      }),
    [scan.rows, standards, sent]
  )

  const selection = useMemo<TransferSelection[]>(
    () =>
      selectedTransfers({
        tokens,
        standards,
        amounts,
        sent,
        selectedKeys,
      }),
    [tokens, standards, amounts, sent, selectedKeys]
  )

  function resetSelection() {
    setSelectedKeys([])
    setAmounts(new Map())
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
      .filter((row) => row.standard !== null && row.remaining >= 1)
      .map((row) => row.token.key)

    if (
      visible.length > 0 &&
      visible.every((key) => selectedKeys.includes(key))
    ) {
      setSelectedKeys((current) => current.filter((key) => !visible.includes(key)))
      return
    }

    setAmounts((current) => {
      const next = new Map(current)
      for (const key of visible) next.set(key, 1)
      return next
    })
    setSelectedKeys((current) => [...new Set([...current, ...visible])])
  }

  function setAmount(key: string, value: string) {
    const token = tokens.find((entry) => entry.key === key)
    const ceiling = token
      ? Math.max(1, Math.floor(token.quantity) - (sent.get(key) ?? 0))
      : 1
    const digits = value.replace(/\D/g, '')
    const parsed = Number.parseInt(digits, 10)
    const amount = Number.isNaN(parsed)
      ? 1
      : Math.min(Math.max(parsed, 1), ceiling)

    setAmounts((current) => new Map(current).set(key, amount))
  }

  function clear() {
    setSelectedKeys([])
    setAmounts(new Map())
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
    collection: scan.collection,
    groups,
    wallets,
    standards,
    selectedKeys,
    amounts,
    selection,
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
    setAmount,
    clear,
    deselect,
    applySent,
    scan: rescan,
  }
}
