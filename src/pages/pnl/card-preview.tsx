import { useRef, type PointerEvent, type Ref } from 'react'
import type { CardImage } from '@/lib/card-images'
import { formatEth, toUsd, type PnlStats } from '@/lib/pnl-trades'
import { cn } from '@/lib/utils'

export const formats = ['Landscape', 'Portrait'] as const

export type Format = (typeof formats)[number]

export type ImagePosition = { x: number; y: number }

const DASH = '—'

type Tone = 'positive' | 'negative' | 'neutral'

const valueTone: Record<Tone, string> = {
  positive: 'text-pnl-positive',
  negative: 'text-pnl-negative',
  neutral: 'text-pnl-on-image',
}

function toneOf(value: bigint): Tone {
  if (value > 0n) return 'positive'
  if (value < 0n) return 'negative'
  return 'neutral'
}

const statRows = [
  { label: 'Realized', read: (stats: PnlStats) => stats.realized, signed: true },
  { label: 'Unrealized', read: (stats: PnlStats) => stats.unrealized, signed: true },
  { label: 'Invested', read: (stats: PnlStats) => stats.spent, signed: false },
  { label: 'Current value', read: (stats: PnlStats) => stats.currentValue, signed: false },
] as const

type PnlDisplay = {
  rows: { label: string; value: string; tone: Tone }[]
  totalEth: string
  totalUsd: string
  totalTone: Tone
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function pnlDisplay(stats: PnlStats | null, price: number | null): PnlDisplay {
  if (stats === null) {
    return {
      rows: statRows.map(({ label }) => ({ label, value: DASH, tone: 'neutral' })),
      totalEth: DASH,
      totalUsd: DASH,
      totalTone: 'neutral',
    }
  }

  const eth = (value: bigint) => `${formatEth(value)} ETH`
  const total = stats.realized + stats.unrealized

  return {
    rows: statRows.map(({ label, read, signed }) => {
      const value = read(stats)
      const tone: Tone = signed ? toneOf(value) : 'neutral'
      return { label, value: eth(value), tone }
    }),
    totalEth: eth(total),
    totalUsd: toUsd(total, price),
    totalTone: toneOf(total),
  }
}

type OverlayProps = {
  name: string
  logo: string
  price: number | null
  priceLoading: boolean
  pnl: PnlDisplay
}

type PriceChipProps = {
  price: number | null
  priceLoading: boolean
  className: string
}

function PriceChip({ price, priceLoading, className }: PriceChipProps) {
  return (
    <span
      className={cn(
        'bg-pnl-overlay text-pnl-on-image-muted shrink-0 whitespace-nowrap',
        className,
        priceLoading && 'animate-pulse',
      )}
    >
      ETH/USDT {price === null ? '—' : currency.format(price)}
    </span>
  )
}

function LandscapeOverlay({ name, logo, price, priceLoading, pnl }: OverlayProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="pointer-events-none absolute inset-x-5 top-5 flex items-start justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:top-3">
        <span className="bg-pnl-overlay text-pnl-on-image flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-base font-medium">
          {logo !== '' && (
            <img
              src={logo}
              alt=""
              draggable={false}
              className="size-6 shrink-0 rounded-md object-cover"
            />
          )}
          <span className="truncate">{name === '' ? 'No collection' : name}</span>
        </span>
        <PriceChip
          price={price}
          priceLoading={priceLoading}
          className="rounded-lg px-2.5 py-1 text-xs"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:bottom-3 @max-[440px]:flex-col @max-[440px]:items-stretch">
        <div className="grid min-w-0 max-w-[360px] flex-1 grid-cols-2 gap-2 @max-[440px]:max-w-none">
          {pnl.rows.map((stat) => (
            <div
              key={stat.label}
              className="bg-pnl-overlay flex min-w-0 flex-col justify-center gap-0.5 rounded-lg px-3 py-2 @max-[440px]:px-2.5 @max-[440px]:py-1.5"
            >
              <span className="text-pnl-on-image-muted text-xs @max-[440px]:text-[11px]">
                {stat.label}
              </span>
              <span
                className={cn(
                  'text-base font-medium whitespace-nowrap @max-[440px]:text-sm',
                  valueTone[stat.tone],
                )}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <span className="text-pnl-on-image-muted text-xs">Total PnL</span>
          <span
            className={cn(
              'text-lg font-semibold @max-[440px]:text-base',
              valueTone[pnl.totalTone],
            )}
          >
            {pnl.totalEth}
          </span>
          <span className="text-pnl-on-image-muted text-xs">{pnl.totalUsd}</span>
        </div>
      </div>
    </>
  )
}

function PortraitOverlay({ name, logo, price, priceLoading, pnl }: OverlayProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/28 via-42% to-transparent" />

      <div className="pointer-events-none absolute inset-x-[6.33cqmin] top-[6.33cqmin] flex items-start justify-between gap-[2.5cqmin]">
        <span className="bg-pnl-overlay text-pnl-on-image flex min-w-0 items-center gap-[1.83cqmin] rounded-[2.33cqmin] px-[3.67cqmin] py-[2.17cqmin] font-medium">
          {logo !== '' && (
            <img
              src={logo}
              alt=""
              draggable={false}
              className="size-[6cqmin] shrink-0 rounded-[1.2cqmin] object-cover"
            />
          )}
          <span className="truncate text-[5.17cqmin]">
            {name === '' ? 'No collection' : name}
          </span>
        </span>
        <PriceChip
          price={price}
          priceLoading={priceLoading}
          className="rounded-[2cqmin] px-[3cqmin] py-[1.83cqmin] text-[3.83cqmin]"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-[6.33cqmin] bottom-[6.33cqmin] flex items-end justify-between gap-[3cqmin]">
        <dl className="flex min-w-0 flex-col gap-[1.83cqmin]">
          {pnl.rows.map((stat) => (
            <div
              key={stat.label}
              className="bg-pnl-overlay flex w-fit min-w-0 flex-col gap-[0.5cqmin] rounded-[2cqmin] px-[2.5cqmin] py-[1.5cqmin]"
            >
              <dt className="text-pnl-on-image-muted text-[3.5cqmin]">
                {stat.label}
              </dt>
              <dd
                className={cn(
                  'text-[4.5cqmin] font-medium whitespace-nowrap',
                  valueTone[stat.tone],
                )}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex shrink-0 flex-col items-end gap-[1cqmin] [text-shadow:0_1px_2px_rgba(0,0,0,0.65),0_1px_6px_rgba(0,0,0,0.45)]">
          <span className="text-pnl-on-image-muted text-[3.83cqmin]">
            Total PnL
          </span>
          <span
            className={cn(
              'text-[8.5cqmin] leading-none font-semibold whitespace-nowrap',
              valueTone[pnl.totalTone],
            )}
          >
            {pnl.totalEth}
          </span>
          <span className="text-pnl-on-image-muted text-[4.17cqmin]">
            {pnl.totalUsd}
          </span>
        </div>
      </div>
    </>
  )
}

type CardPreviewProps = {
  cardRef: Ref<HTMLDivElement>
  format: Format
  name: string
  logo: string
  image: CardImage | null
  position: ImagePosition
  onPosition: (next: ImagePosition) => void
  price: number | null
  priceLoading: boolean
  stats: PnlStats | null
}

export function CardPreview({
  cardRef,
  format,
  name,
  logo,
  image,
  position,
  onPosition,
  price,
  priceLoading,
  stats,
}: CardPreviewProps) {
  const drag = useRef<{
    clientX: number
    clientY: number
    position: ImagePosition
  } | null>(null)

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      position,
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (start === null) return

    const rect = event.currentTarget.getBoundingClientRect()
    const node = event.currentTarget.querySelector('img')
    // object-position spans the cover overflow, not the box, so the pointer
    // delta is divided by the overflow on each axis.
    const image =
      node !== null && node.naturalWidth > 0 && node.naturalHeight > 0 ? node : null

    if (image === null) return

    const cover = Math.max(
      rect.width / image.naturalWidth,
      rect.height / image.naturalHeight,
    )
    const spanX = image.naturalWidth * cover - rect.width
    const spanY = image.naturalHeight * cover - rect.height

    const nextX =
      spanX <= 0
        ? start.position.x
        : start.position.x - ((event.clientX - start.clientX) / spanX) * 100
    const nextY =
      spanY <= 0
        ? start.position.y
        : start.position.y - ((event.clientY - start.clientY) / spanY) * 100

    onPosition({
      x: Math.min(100, Math.max(0, nextX)),
      y: Math.min(100, Math.max(0, nextY)),
    })
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const overlay: OverlayProps = {
    name,
    logo,
    price,
    priceLoading,
    pnl: pnlDisplay(stats, price),
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        // Portrait sizes its overlay in cqmin, so the frame is a size container.
        '[container-type:size] relative overflow-hidden rounded-xl',
        format === 'Landscape'
          ? 'aspect-[959/600] w-[min(100cqw,calc(100cqh*959/600))]'
          : 'aspect-[600/959] w-[min(100%,max(14rem,calc((100vh-20rem)*600/959)))]',
        image !== null && 'cursor-grab touch-none select-none active:cursor-grabbing',
      )}
      onPointerDown={image === null ? undefined : startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* draggable={false} stops the native image drag from cancelling the pointer drag. */}
      {image === null ? (
        <div className="bg-muted flex size-full items-center justify-center">
          <span className="text-muted-foreground text-sm">
            No image yet
          </span>
        </div>
      ) : (
        <img
          src={image.src}
          alt=""
          draggable={false}
          style={{ objectPosition: `${position.x}% ${position.y}%` }}
          className="size-full object-cover"
        />
      )}
      {format === 'Landscape' ? (
        <LandscapeOverlay {...overlay} />
      ) : (
        <PortraitOverlay {...overlay} />
      )}
    </div>
  )
}
