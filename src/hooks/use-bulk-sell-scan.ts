import { useMemo } from 'react'
import { useHoldingsScan } from '@/hooks/use-holdings-scan'
import { useSelection } from '@/hooks/use-selection'
import type { ListingToken } from '@/lib/listings/listing-plan'

export function useBulkSellScan() {
  const scan = useHoldingsScan()
  const select = useSelection(scan.rows, {
    keyOf: (row) => row.key,
    // A row whose whole-unit balance is zero cannot be listed, so select-all
    // leaves it out rather than poisoning the run.
    isSelectable: (row) => Math.floor(row.quantity) >= 1,
  })

  const selection = useMemo<ListingToken[]>(
    () =>
      scan.tokens.flatMap((row) => {
        const units = Math.floor(row.quantity)
        if (!select.selectedKeys.includes(row.key) || units < 1) return []
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
    [scan.tokens, select.selectedKeys]
  )

  function changeUrl(next: string) {
    if (scan.running) return
    select.setKeys([])
    scan.changeUrl(next)
  }

  function changeWallets(ids: string[]) {
    if (scan.running) return
    select.setKeys([])
    scan.changeWallets(ids)
  }

  async function rescan() {
    if (scan.running) return
    select.setKeys([])
    await scan.scan()
  }

  return {
    url: scan.url,
    selectedWallets: scan.selectedWallets,
    state: scan.state,
    rows: scan.rows,
    totalRows: scan.totalRows,
    query: scan.query,
    setQuery: scan.setQuery,
    selectedKeys: select.selectedKeys,
    selection,
    running: scan.running,
    canScan: scan.canScan,
    collection: scan.collection,
    changeUrl,
    changeWallets,
    toggleToken: select.toggle,
    toggleAll: select.toggleAll,
    deselect: select.deselect,
    scan: rescan,
    selectKeys: select.setKeys,
  }
}
