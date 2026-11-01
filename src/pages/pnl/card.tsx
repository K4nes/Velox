import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ChartLine, Download, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WalletSelect } from '@/components/wallet-select'
import { chainBySlug } from '@/config/chains'
import { useEthPrice } from '@/hooks/use-eth-price'
import { useWalletGroups } from '@/hooks/use-wallets'
import { exportCard as saveCard } from '@/lib/card-export'
import {
  persistImages,
  readImageFile,
  readStoredImages,
  type CardImage,
} from '@/lib/card-images'
import { getCollection, slugFromUrl, type CollectionInfo } from '@/lib/opensea'
import {
  fetchCollectionTrades,
  summarize,
  type PnlStats,
} from '@/lib/pnl-trades'
import { cn } from '@/lib/utils'
import { listWallets, uid, type StoredWallet } from '@/lib/wallets'
import { CardPreview, formats } from './card-preview'
import type { Format, ImagePosition } from './card-preview'

const MAX_IMAGES = 3
const DEFAULT_POSITION: ImagePosition = { x: 50, y: 50 }

export function PnlCardPage() {
  const [collectionUrl, setCollectionUrl] = useState('')
  const [collection, setCollection] = useState<CollectionInfo | null>(null)
  const [uploads, setUploads] = useState<CardImage[]>(() =>
    readStoredImages().slice(0, MAX_IMAGES),
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, ImagePosition>>({})
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])
  const [format, setFormat] = useState<Format>('Landscape')
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [wallets, setWallets] = useState<StoredWallet[]>([])
  const [statsRead, setStatsRead] = useState<{
    key: string
    stats: PnlStats | null
  } | null>(null)
  const [statsVersion, setStatsVersion] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const savedUploads = useRef(uploads)
  const { price, loading: priceLoading, refresh } = useEthPrice()
  const { groups } = useWalletGroups()
  const chain = collection === null ? undefined : chainBySlug(collection.chain)
  const explorerApi = chain?.explorerApi ?? ''
  const contract = collection?.contractAddress ?? ''
  const wrappedNative = chain?.wrappedNative ?? ''
  const addresses = wallets
    .filter((wallet) => selectedWallets.includes(wallet.id))
    .map((wallet) => wallet.address)
    .join(',')
  const requestKey =
    explorerApi === '' || contract === '' || addresses === ''
      ? ''
      : `${explorerApi}|${contract}|${addresses}`
  const stats = statsRead !== null && statsRead.key === requestKey ? statsRead.stats : null
  const statsLoading = requestKey !== '' && statsRead?.key !== requestKey
  const busy = running || statsLoading

  useEffect(() => {
    let cancelled = false

    listWallets()
      .then((all) => {
        if (!cancelled) setWallets(all)
      })
      .catch((failure) => {
        if (!cancelled) {
          toast.error(failure instanceof Error ? failure.message : String(failure))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  // A re-check of the same collection keeps the same request key, so the version
  // is what makes the chain read happen again.
  useEffect(() => {
    if (requestKey === '') return

    let cancelled = false
    const controller = new AbortController()

    fetchCollectionTrades(
      explorerApi,
      contract,
      addresses.split(','),
      wrappedNative,
      controller.signal,
    )
      .then(({ trades, truncated }) => {
        if (cancelled) return
        setStatsRead({ key: requestKey, stats: summarize(trades) })
        if (truncated) {
          toast.info('These numbers only cover the newest transfers', {
            id: 'pnl-truncated',
          })
        }
      })
      .catch((failure) => {
        if (cancelled) return
        setStatsRead({ key: requestKey, stats: null })
        toast.error(failure instanceof Error ? failure.message : String(failure))
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [explorerApi, contract, addresses, wrappedNative, requestKey, statsVersion])

  useEffect(() => {
    // Mounting would write the list the browser already holds, which can only
    // toast a storage error the user did not cause.
    if (savedUploads.current === uploads) return
    savedUploads.current = uploads
    const stored = persistImages(uploads)
    if (stored === 'quota') {
      toast.error('Images are too large to save in this browser')
    }
    if (stored === 'blocked') {
      toast.error('This browser will not store images, so the card resets on reload')
    }
  }, [uploads])

  const active =
    uploads.find((image) => image.id === activeId) ?? uploads[0] ?? null
  const position =
    active === null ? DEFAULT_POSITION : (positions[active.id] ?? DEFAULT_POSITION)

  async function check() {
    const slug = slugFromUrl(collectionUrl)
    if (slug === null) {
      toast.error('Collection URL not recognised')
      return
    }
    if (selectedWallets.length === 0) {
      toast.error('Select a wallet first')
      return
    }

    setRunning(true)
    try {
      const info = await getCollection(slug)
      setCollection(info)
      void refresh()
      const chainEntry = chainBySlug(info.chain)
      if (chainEntry === undefined || chainEntry.explorerApi === '') {
        toast.error(
          `PnL is not available on ${chainEntry?.name ?? info.chain}`,
        )
        return
      }
      setStatsVersion((current) => current + 1)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRunning(false)
    }
  }

  function moveImage(next: ImagePosition) {
    if (active === null) return
    setPositions((current) => ({ ...current, [active.id]: next }))
  }

  async function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return

    try {
      const src = await readImageFile(file)
      setUploads((current) =>
        current.length >= MAX_IMAGES
          ? current
          : [...current, { id: uid(), src, label: file.name }],
      )
    } catch {
      toast.error('Could not read that image')
    }
  }

  function removeImage(id: string) {
    setUploads((current) => current.filter((image) => image.id !== id))
  }

  async function exportCard() {
    const node = cardRef.current
    if (node === null) return

    setExporting(true)
    try {
      const outcome = await saveCard(
        node,
        `${collection?.slug ?? 'pnl'}-card.png`,
      )
      if (outcome === 'saved') toast.success('Card saved')
      if (outcome === 'downloaded') {
        toast.success('Card saved to your Downloads folder')
      }
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setExporting(false)
    }
  }

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
      <Card className="gap-3 p-4 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="collection-url" className="text-xs font-medium">
            Collection URL or slug (OpenSea / Scatter)
          </label>
          <Input
            id="collection-url"
            value={collectionUrl}
            onChange={(event) => setCollectionUrl(event.target.value)}
            placeholder="https://opensea.io/collection/… or https://scatter.art/…"
          />
        </div>
        <div
          className="flex flex-col gap-1.5 lg:w-[280px]"
          role="group"
          aria-labelledby="wallet-label"
        >
          <span id="wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={groups}
            selected={selectedWallets}
            onSelectedChange={setSelectedWallets}
            className="w-full"
          />
        </div>
        <Button
          className="shrink-0"
          onClick={() => void check()}
          disabled={busy || collectionUrl.trim() === ''}
        >
          {busy ? <Spinner /> : <ChartLine />}
          Check PnL
        </Button>
      </Card>

      {formats.map((option) => (
        <TabsContent
          key={option}
          value={option}
          className="flex min-h-0 flex-1 items-center justify-center [container-type:size] focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {option === format && (
            <CardPreview
              cardRef={cardRef}
              format={option}
              name={collection?.name ?? ''}
              logo={collection?.imageUrl ?? ''}
              image={active}
              position={position}
              onPosition={moveImage}
              price={price}
              priceLoading={priceLoading}
              stats={stats}
            />
          )}
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
          {uploads.map((image) => (
            <div key={image.id} className="relative">
              <button
                type="button"
                aria-label={image.label === '' ? 'Collection image' : image.label}
                aria-pressed={image.id === active?.id}
                onClick={() => setActiveId(image.id)}
                className={cn(
                  'block h-9 w-16 overflow-hidden rounded-lg border',
                  image.id === active?.id && 'ring-2 ring-ring',
                )}
              >
                <img src={image.src} alt="" className="size-full object-cover" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${image.label === '' ? 'image' : image.label}`}
                onClick={() => removeImage(image.id)}
                className="bg-background text-muted-foreground hover:text-foreground absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <Button
            variant="outline"
            className="h-9 w-16"
            aria-label="Add image"
            onClick={() => fileInput.current?.click()}
            disabled={uploads.length >= MAX_IMAGES}
          >
            <Plus />
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={pickImage}
          />
        </div>
        <Button
          className="shrink-0"
          onClick={() => void exportCard()}
          disabled={exporting}
        >
          {exporting ? <Spinner /> : <Download />}
          Export Card
        </Button>
      </Card>
    </Tabs>
  )
}
