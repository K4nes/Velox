import { useState } from 'react'
import { ArrowRight, Layers, ScrollText } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { WalletSelect } from '@/components/wallet-select'
import { walletGroups } from '@/config/wallets'

const chains = ['Ethereum', 'Base', 'Robinhood Chain']
const assets = ['WETH · Wrapped Ether', 'ETH · Ether', 'USDC · USD Coin']
const slippageOptions = ['Auto · 0.5%', '0.1%', '0.5%', '1%']

const amountInput = (raw: string) => (/^\d*\.?\d*$/.test(raw) ? raw : null)

type SwapRow = {
  id: string
  wallet: string
  address: string
  balance: number
  received: number
  fee: number
  steps: string
  status: 'Ready' | 'Quote expired'
  gasFunded: boolean
}

const swapRows: SwapRow[] = []

export function SwapPage() {
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [origin, setOrigin] = useState(chains[0])
  const [destination, setDestination] = useState('Same as origin')
  const [sellAsset, setSellAsset] = useState(assets[0])
  const [buyAsset, setBuyAsset] = useState(assets[1])
  const [slippage, setSlippage] = useState(slippageOptions[0])
  const [defaultAmount, setDefaultAmount] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  const sellSymbol = sellAsset.split(' · ')[0]
  const buySymbol = buyAsset.split(' · ')[0]

  const totalIn = swapRows.reduce(
    (sum, row) =>
      sum + (Number.parseFloat(amounts[row.id] ?? defaultAmount) || 0),
    0
  )
  const readyCount = swapRows.filter((row) => row.status === 'Ready').length
  const expiredCount = swapRows.length - readyCount
  const fundedCount = swapRows.filter((row) => row.gasFunded).length
  const pendingApprovals = swapRows.filter((row) =>
    row.steps.startsWith('Approve')
  ).length

  const hasRows = swapRows.length > 0
  const walletCountLabel = `${swapRows.length} ${
    swapRows.length === 1 ? 'wallet' : 'wallets'
  }`
  const route =
    destination === 'Same as origin' || destination === origin
      ? `Same-chain swap · ${origin}`
      : `${origin} → ${destination}`

  const readiness = [
    {
      label: 'Relay quotes',
      value: hasRows ? `${readyCount} fresh · ${expiredCount} expired` : '–',
    },
    {
      label: 'Token approvals',
      value: hasRows
        ? `${pendingApprovals} wallet${pendingApprovals === 1 ? '' : 's'} pending`
        : '–',
    },
    {
      label: 'Native gas',
      value: hasRows ? `${fundedCount} of ${swapRows.length} funded` : '–',
    },
    { label: 'Route', value: route },
  ]

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="gap-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div
            className="flex flex-col gap-1.5 lg:w-[280px]"
            role="group"
            aria-labelledby="swap-wallet-label"
          >
            <span id="swap-wallet-label" className="text-xs font-medium">
              Wallet
            </span>
            <WalletSelect
              groups={walletGroups}
              selected={selectedWallets}
              onSelectedChange={setSelectedWallets}
              aria-labelledby="swap-wallet-label"
              className="w-full"
            />
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="swap-origin" className="text-xs font-medium">
              Origin chain
            </label>
            <Select value={origin} onValueChange={setOrigin}>
              <SelectTrigger id="swap-origin" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {chains.map((chain) => (
                  <SelectItem key={chain} value={chain}>
                    {chain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="swap-destination" className="text-xs font-medium">
              Destination chain
            </label>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger id="swap-destination" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['Same as origin', ...chains].map((chain) => (
                  <SelectItem key={chain} value={chain}>
                    {chain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="swap-sell" className="text-xs font-medium">
              Sell / Source asset
            </label>
            <Select value={sellAsset} onValueChange={setSellAsset}>
              <SelectTrigger id="swap-sell" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assets.map((asset) => (
                  <SelectItem key={asset} value={asset}>
                    {asset}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden shrink-0 pb-2 lg:block">
            <ArrowRight aria-hidden className="text-muted-foreground size-4" />
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="swap-buy" className="text-xs font-medium">
              Receive asset
            </label>
            <Select value={buyAsset} onValueChange={setBuyAsset}>
              <SelectTrigger id="swap-buy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assets.map((asset) => (
                  <SelectItem key={asset} value={asset}>
                    {asset}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 lg:w-[200px]">
            <label htmlFor="swap-slippage" className="text-xs font-medium">
              Slippage tolerance
            </label>
            <Select value={slippage} onValueChange={setSlippage}>
              <SelectTrigger id="swap-slippage" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {slippageOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold">Batch</h2>
              <Badge variant="secondary">{walletCountLabel}</Badge>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label
                htmlFor="default-amount"
                className="text-xs font-medium whitespace-nowrap"
              >
                Default amount
              </label>
              <Input
                id="default-amount"
                inputMode="decimal"
                placeholder="0.0"
                value={defaultAmount}
                onChange={(event) => {
                  const next = amountInput(event.target.value)
                  if (next !== null) setDefaultAmount(next)
                }}
                className="w-[140px]"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <Table aria-label="Swap batch">
              <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
                <TableRow>
                  <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                    Wallet
                  </TableHead>
                  <TableHead className="text-muted-foreground w-[120px] px-3 text-xs font-medium">
                    Balance
                  </TableHead>
                  <TableHead className="text-muted-foreground w-[120px] px-3 text-xs font-medium">
                    Amount
                  </TableHead>
                  <TableHead className="text-muted-foreground w-[140px] px-3 text-xs font-medium">
                    Est. received
                  </TableHead>
                  <TableHead className="text-muted-foreground w-[100px] px-3 text-xs font-medium">
                    Fee
                  </TableHead>
                  <TableHead className="text-muted-foreground w-[130px] px-3 text-xs font-medium">
                    Steps
                  </TableHead>
                  <TableHead className="text-muted-foreground w-[140px] px-3 text-xs font-medium">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {swapRows.map((row) => (
                  <TableRow key={row.id} className="h-14">
                    <TableCell className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium">
                          {row.wallet}
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                          {row.address}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground px-3 py-2 text-[13px] tabular-nums">
                      {row.balance.toFixed(4)} {sellSymbol}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <label htmlFor={`amount-${row.id}`} className="sr-only">
                        Amount for {row.wallet}
                      </label>
                      <Input
                        id={`amount-${row.id}`}
                        inputMode="decimal"
                        value={amounts[row.id] ?? defaultAmount}
                        onChange={(event) => {
                          const next = amountInput(event.target.value)
                          if (next === null) return
                          setAmounts((current) => ({
                            ...current,
                            [row.id]: next,
                          }))
                        }}
                        className="w-24"
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-[13px] tabular-nums">
                      {row.received.toFixed(4)} {buySymbol}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-3 py-2 text-[13px] tabular-nums">
                      {row.fee.toFixed(4)} ETH
                    </TableCell>
                    <TableCell className="text-muted-foreground px-3 py-2 text-[13px]">
                      {row.steps}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={
                          row.status === 'Ready'
                            ? 'border-success/30 bg-success/10 text-success'
                            : 'border-warning/30 bg-warning/10 text-warning'
                        }
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {!hasRows ? (
              <div className="flex flex-1 items-center justify-center p-4">
                <EmptyState
                  icon={Layers}
                  title="No wallets in the batch"
                  description="Pick the wallets and the assets above to build a swap batch."
                />
              </div>
            ) : null}
          </div>

          <div className="mt-auto flex shrink-0 flex-col gap-3 border-t p-4 xl:flex-row xl:items-center xl:justify-between">
            <span className="text-lg font-semibold tabular-nums">
              {totalIn.toFixed(4)} {sellSymbol}
            </span>
            <div className="flex items-center gap-2 xl:justify-end">
              {expiredCount > 0 ? (
                <span className="text-warning text-xs">
                  {expiredCount} {expiredCount === 1 ? 'quote' : 'quotes'}{' '}
                  expired
                </span>
              ) : null}
              <Button variant="ghost" disabled={!hasRows}>
                Requote all
              </Button>
              <Button className="h-10" disabled={readyCount === 0}>
                Execute
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
          <Card className="shrink-0 gap-0 overflow-hidden py-0">
            <div className="flex h-12 shrink-0 items-center border-b px-4">
              <h2 className="truncate text-[13px] font-semibold">
                Batch readiness
              </h2>
            </div>
            <dl className="flex flex-col gap-3 p-4">
              {readiness.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-3"
                >
                  <dt className="text-[13px]">{row.label}</dt>
                  <dd className="text-muted-foreground text-[13px] tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
            <div className="flex h-12 shrink-0 items-center border-b px-4">
              <h2 className="truncate text-[13px] font-semibold">Runner log</h2>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="m-auto flex flex-col items-center">
                <EmptyState icon={ScrollText} title="Nothing executed yet" />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
