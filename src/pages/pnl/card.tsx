import { useState } from 'react'
import { ChartLine, Download, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WalletSelect } from '@/components/wallet-select'
import { walletGroups } from '@/config/wallets'
import { cn } from '@/lib/utils'

const formats = ['Landscape', 'Portrait'] as const

type Format = (typeof formats)[number]

const stats = [
  { label: 'Realized', value: '0.0000 ETH' },
  { label: 'Unrealized', value: '0.0000 ETH' },
  { label: 'Invested', value: '0.0000 ETH' },
  { label: 'Current value', value: '0.0000 ETH' },
]

function CardPreview({ format }: { format: Format }) {
  return (
    <div
      className={cn(
        '@container relative overflow-hidden rounded-xl',
        format === 'Landscape'
          ? 'aspect-[959/600] w-[min(100%,calc((100svh-16rem)*959/600))] max-w-3xl'
          : 'aspect-[600/959] w-[min(100%,max(14rem,calc((100vh-20rem)*600/959)))]',
      )}
    >
      <img
        src="/pnl-card-preview.png"
        alt=""
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="absolute inset-x-5 top-5 flex items-start justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:top-3">
        <span className="bg-pnl-overlay text-pnl-on-image rounded-lg px-3 py-2 text-base font-medium whitespace-nowrap">
          PnL Card Preview
        </span>
        <span className="bg-pnl-overlay text-pnl-on-image-muted rounded-lg px-2.5 py-1 text-xs whitespace-nowrap">
          ETH/USD $3000.00
        </span>
      </div>

      <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:bottom-3">
        <div className="grid min-w-0 max-w-[360px] flex-1 grid-cols-2 gap-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-pnl-overlay flex min-w-0 flex-col justify-center gap-0.5 rounded-lg px-3 py-2"
            >
              <span className="text-pnl-on-image-muted text-xs">
                {stat.label}
              </span>
              <span className="text-pnl-on-image text-base font-medium whitespace-nowrap">
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <span className="text-pnl-on-image-muted text-xs">Total PnL</span>
          <span className="text-pnl-on-image text-lg font-semibold">
            0.0000 ETH
          </span>
          <span className="text-pnl-on-image-muted text-xs">$0.00</span>
        </div>
      </div>
    </div>
  )
}

export function PnlCardPage() {
  const [collectionUrl, setCollectionUrl] = useState('')
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [format, setFormat] = useState<Format>('Landscape')

  return (
    <Tabs
      value={format}
      onValueChange={(value) => {
        if ((formats as readonly string[]).includes(value)) {
          setFormat(value as Format)
        }
      }}
      className="flex flex-1 flex-col gap-4 p-6"
    >
      <Card className="p-4 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="collection-url" className="text-xs font-medium">
            Collection URL or slug
          </label>
          <Input
            id="collection-url"
            value={collectionUrl}
            onChange={(event) => setCollectionUrl(event.target.value)}
            placeholder="https://opensea.io/collection/… or https://scatter.art/…"
          />
        </div>
        <div
          className="flex flex-col gap-1.5 lg:w-72"
          role="group"
          aria-labelledby="wallet-label"
        >
          <span id="wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={walletGroups}
            selected={selectedWallets}
            onSelectedChange={setSelectedWallets}
            className="w-full"
          />
        </div>
        <Button className="shrink-0">
          <ChartLine />
          Check PnL
        </Button>
      </Card>

      {formats.map((option) => (
        <TabsContent
          key={option}
          value={option}
          className="flex min-h-0 flex-1 items-center justify-center focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CardPreview format={option} />
        </TabsContent>
      ))}

      <Card className="flex-row flex-wrap items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-xs font-medium">
            Format
          </span>
          <TabsList aria-label="Format">
            {formats.map((option) => (
              <TabsTrigger key={option} value={option}>
                {option}
              </TabsTrigger>
            ))}
          </TabsList>
          <Separator
            orientation="vertical"
            className="h-6 data-vertical:self-center"
          />
          <span className="text-muted-foreground text-xs font-medium">
            Image
          </span>
          <img
            src="/pnl-card-preview.png"
            alt=""
            className="h-9 w-16 rounded-lg border object-cover"
          />
          <Button variant="outline" className="h-9 w-16" aria-label="Add image">
            <Plus />
          </Button>
        </div>
        <Button className="shrink-0">
          <Download />
          Export PNG
        </Button>
      </Card>
    </Tabs>
  )
}
