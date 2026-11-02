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
import { useWalletGroups } from '@/hooks/use-wallets'
import { exportCard as saveCard } from '@/lib/card-export'
import { persistImages, readImageFile } from '@/lib/card-images'
import { getCollection, slugFromUrl } from '@/lib/opensea'
import { upsertPnlRecord } from '@/lib/pnl-records'
import { fetchCollectionTrades, summarize } from '@/lib/pnl-trades'
import { cn } from '@/lib/utils'
import { listWallets, uid, type StoredWallet } from '@/lib/wallets'
import { CardPreview, formats } from './card-preview'
import type { Format, ImagePosition } from './card-preview'
import { MAX_IMAGES, pnlCard, usePnlCard } from './card-state'

const DEFAULT_POSITION: ImagePosition = { x: 50, y: 50 }

export function PnlCardPage() {
  const {
    collectionUrl,
    collection,
    walletIds,
    format,
    uploads,
    activeImageId,
    positions,
    version,
    read,
    quote,
  } = usePnlCard()
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [wallets, setWallets] = useState<StoredWallet[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const savedUploads = useRef(uploads)
  const { groups } = useWalletGroups()
  const chain = collection === null ? undefined : chainBySlug(collection.chain)
  const explorerApi = chain?.explorerApi ?? ''
  const contract = collection?.contractAddress ?? ''
  const wrappedNative = chain?.wrappedNative ?? ''
  const addresses = wallets
    .filter((wallet) => walletIds.includes(wallet.id))
    .map((wallet) => wallet.address)
    .join(',')
  const requestKey =
    explorerApi === '' || contract === '' || addresses === ''
      ? ''
      : `${explorerApi}|${contract}|${addresses}`
  const currentRead =
    read !== null && read.key === requestKey && read.version === version ? read : null
  const stats = currentRead?.stats ?? null
  const statsLoading =
    requestKey !== '' &&
    (read === null || read.key !== requestKey || read.version !== version)
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

  useEffect(() => {
    void pnlCard.loadQuote()
  }, [])

  // A re-check of the same collection keeps the same request key, so the version
  // is what makes the chain read happen again. A remount finds the answer still
  // in the store and skips the read entirely.
  useEffect(() => {
    if (requestKey === '') return
    if (read !== null && read.key === requestKey && read.version === version) {
      if (read.truncated) {
        toast.info('These numbers only cover the newest transfers', {
          id: 'pnl-truncated',
        })
      }
      if (read.unpriced) {
        toast.info('Some trades are left out because their payment is unclear', {
          id: 'pnl-unpriced',
        })
      }
      if (read.error !== null) {
        toast.error(read.error, { id: 'pnl-read-error' })
      }
      return
    }

    let cancelled = false
    const controller = new AbortController()

    fetchCollectionTrades(
      explorerApi,
      contract,
      addresses.split(','),
      wrappedNative,
      controller.signal,
    )
      .then(({ trades, truncated, unpriced }) => {
        if (cancelled) return
        pnlCard.setRead({
          key: requestKey,
          version,
          stats: summarize(trades),
          truncated,
          unpriced,
          error: null,
          at: Date.now(),
        })
        if (truncated) {
          toast.info('These numbers only cover the newest transfers', {
            id: 'pnl-truncated',
          })
        }
        if (unpriced) {
          toast.info('Some trades are left out because their payment is unclear', {
            id: 'pnl-unpriced',
          })
        }
      })
      .catch((failure) => {
        if (cancelled) return
        const message = failure instanceof Error ? failure.message : String(failure)
        pnlCard.setRead({
          key: requestKey,
          version,
          stats: null,
          truncated: false,
          unpriced: false,
          error: message,
          at: Date.now(),
        })
        toast.error(message, { id: 'pnl-read-error' })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    explorerApi,
    contract,
    addresses,
    wrappedNative,
    requestKey,
    version,
    read,
  ])

  // The write belongs to the check, so it is keyed on the read's own timestamp
  // and only fires for the request that produced it. A remount replays the
  // stored read and rewrites the same row instead of inventing one for the day
  // it was reopened, and a new collection or wallet set cannot inherit the
  // previous check's numbers while its own read is still missing.
  useEffect(() => {
    if (currentRead === null || currentRead.stats === null) return
    if (collection === null || addresses === '') return
    if (currentRead.stats.held + currentRead.stats.sold === 0) return

    upsertPnlRecord({
      slug: collection.slug,
      name: collection.name,
      imageUrl: collection.imageUrl,
      chain: collection.chain,
      contract: collection.contractAddress,
      wallets: addresses.split(','),
      stats: currentRead.stats,
      truncated: currentRead.truncated,
      unpriced: currentRead.unpriced,
      ethPriceUsd: quote.price,
      now: currentRead.at,
    }).catch((failure: unknown) => {
      toast.error(failure instanceof Error ? failure.message : String(failure))
    })
  }, [currentRead, collection, addresses, quote.price])

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
    uploads.find((image) => image.id === activeImageId) ?? uploads[0] ?? null
  const position =
    active === null ? DEFAULT_POSITION : (positions[active.id] ?? DEFAULT_POSITION)

  async function check() {
    const slug = slugFromUrl(collectionUrl)
    if (slug === null) {
      toast.error('Collection URL not recognised')
      return
    }
    if (walletIds.length === 0) {
      toast.error('Select a wallet first')
      return
    }
    if (addresses === '') {
      toast.error('The selected wallets are no longer available')
      return
    }

    setRunning(true)
    try {
      const info = await getCollection(slug)
      pnlCard.setCollection(info)
      void pnlCard.loadQuote(true)
      const chainEntry = chainBySlug(info.chain)
      if (chainEntry === undefined || chainEntry.explorerApi === '') {
        toast.error(
          `PnL is not available on ${chainEntry?.name ?? info.chain}`,
        )
        return
      }
      pnlCard.bumpVersion()
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRunning(false)
    }
  }

  function moveImage(next: ImagePosition) {
    if (active === null) return
    pnlCard.setPosition(active.id, next)
  }

  async function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return

    try {
      const src = await readImageFile(file)
      pnlCard.setUploads((current) =>
        current.length >= MAX_IMAGES
          ? current
          : [...current, { id: uid(), src, label: file.name }],
      )
    } catch {
      toast.error('Could not read that image')
    }
  }

  function removeImage(id: string) {
    pnlCard.setUploads((current) =>
      current.filter((image) => image.id !== id),
    )
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
          pnlCard.setFormat(value as Format)
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
            onChange={(event) => pnlCard.setCollectionUrl(event.target.value)}
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
            selected={walletIds}
            onSelectedChange={pnlCard.setWalletIds}
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
          <CardPreview
            cardRef={option === format ? cardRef : null}
            format={option}
            name={collection?.name ?? ''}
            logo={collection?.imageUrl ?? ''}
            image={active}
            position={position}
            onPosition={moveImage}
            price={quote.price}
            priceLoading={quote.loading}
            stats={stats}
          />
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
                onClick={() => pnlCard.setActiveImageId(image.id)}
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
          {uploads.length < MAX_IMAGES && (
            <Button
              variant="outline"
              className="h-9 w-16"
              aria-label="Add image"
              onClick={() => fileInput.current?.click()}
            >
              <Plus />
            </Button>
          )}
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
