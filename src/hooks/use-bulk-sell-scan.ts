import { useMemo, useState } from 'react'
import { useHoldingsScan } from '@/hooks/use-holdings-scan'
import type { ListingToken } from '@/lib/listing-plan'

export function useBulkSellScan() {
  const scan = useHoldingsScan()
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([])

  const selection = useMemo<ListingToken[]>(
    () =>
      scan.tokens.flatMap((row) => {
        const units = Math.floor(row.quantity)
        if (!selectedKeys.includes(row.key) || units < 1) return []
        return [
          {
            key: row.key,
            address: row.owner.address,
            label: row.owner.label,
            chain: row.chain,
            contract: row.contractAddress,
            tokenId: row.tokenId,
            quantity: units,
          },
        ]
      }),
    [scan.tokens, selectedKeys]
  )

  function toggleToken(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key]
    )
  }

  function toggleAll() {
    // A row whose whole-unit balance is zero cannot be listed, so select-all
    // leaves it out rather than poisoning the run.
    const visible = scan.rows
      .filter((row) => Math.floor(row.quantity) >= 1)
      .map((row) => row.key)
    setSelectedKeys((current) => {
      const allSelected = visible.every((key) => current.includes(key))
      return allSelected
        ? current.filter((key) => !visible.includes(key))
        : [...new Set([...current, ...visible])]
    })
  }

  function deselect(keys: readonly string[]) {
    setSelectedKeys((current) => current.filter((key) => !keys.includes(key)))
  }

  function changeUrl(next: string) {
    if (scan.running) return
    setSelectedKeys([])
    scan.changeUrl(next)
  }

  function changeWallets(ids: string[]) {
    if (scan.running) return
    setSelectedKeys([])
    scan.changeWallets(ids)
  }

  async function rescan() {
    if (scan.running) return
    setSelectedKeys([])
    await scan.scan()
  }

  function selectKeys(keys: readonly string[]) {
    setSelectedKeys(keys)
  }

  return {
    url: scan.url,
    selectedWallets: scan.selectedWallets,
    state: scan.state,
    rows: scan.rows,
    totalRows: scan.totalRows,
    query: scan.query,
    setQuery: scan.setQuery,
    selectedKeys,
    selection,
    running: scan.running,
    canScan: scan.canScan,
    collection: scan.collection,
    changeUrl,
    changeWallets,
    toggleToken,
    toggleAll,
    deselect,
    scan: rescan,
    selectKeys,
  }
}
