import { useRef, type PointerEvent } from 'react'
import type { CardImage } from '@/lib/card-images'
import { cn } from '@/lib/utils'

export const formats = ['Landscape', 'Portrait'] as const

export type Format = (typeof formats)[number]

export type ImagePosition = { x: number; y: number }

const stats = [
  { label: 'Realized', value: '0.0000 ETH' },
  { label: 'Unrealized', value: '0.0000 ETH' },
  { label: 'Invested', value: '0.0000 ETH' },
  { label: 'Current value', value: '0.0000 ETH' },
]

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

type OverlayProps = {
  name: string
  price: number | null
  priceLoading: boolean
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

function LandscapeOverlay({ name, price, priceLoading }: OverlayProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="pointer-events-none absolute inset-x-5 top-5 flex items-start justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:top-3">
        <span className="bg-pnl-overlay text-pnl-on-image rounded-lg px-3 py-2 text-base font-medium whitespace-nowrap">
          {name === '' ? 'No collection' : name}
        </span>
        <PriceChip
          price={price}
          priceLoading={priceLoading}
          className="rounded-lg px-2.5 py-1 text-xs"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:bottom-3 @max-[440px]:flex-col @max-[440px]:items-stretch">
        <div className="grid min-w-0 max-w-[360px] flex-1 grid-cols-2 gap-2 @max-[440px]:max-w-none">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-pnl-overlay flex min-w-0 flex-col justify-center gap-0.5 rounded-lg px-3 py-2 @max-[440px]:px-2.5 @max-[440px]:py-1.5"
            >
              <span className="text-pnl-on-image-muted text-xs @max-[440px]:text-[11px]">
                {stat.label}
              </span>
              <span className="text-pnl-on-image text-base font-medium whitespace-nowrap @max-[440px]:text-sm">
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <span className="text-pnl-on-image-muted text-xs">Total PnL</span>
          <span className="text-pnl-on-image text-lg font-semibold @max-[440px]:text-base">
            0.0000 ETH
          </span>
          <span className="text-pnl-on-image-muted text-xs">$0.00</span>
        </div>
      </div>
    </>
  )
}

function PortraitOverlay({ name, price, priceLoading }: OverlayProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/95 via-black/80 to-transparent" />

      <div className="pointer-events-none absolute inset-x-[6.33cqmin] top-[6.33cqmin] flex items-start justify-between gap-[2.5cqmin]">
        <span className="bg-pnl-overlay text-pnl-on-image min-w-0 truncate rounded-[2.33cqmin] px-[3.67cqmin] py-[2.17cqmin] text-[5.17cqmin] font-medium">
          {name === '' ? 'No collection' : name}
        </span>
        <PriceChip
          price={price}
          priceLoading={priceLoading}
          className="rounded-[2cqmin] px-[3cqmin] py-[1.83cqmin] text-[3.83cqmin]"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-[6.33cqmin] bottom-[6.33cqmin] flex flex-col">
        <dl className="grid grid-cols-2 gap-x-[2.5cqmin] gap-y-[3.67cqmin]">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col gap-[0.83cqmin]">
              <dt className="text-pnl-on-image-muted text-[3.5cqmin]">
                {stat.label}
              </dt>
              <dd className="text-pnl-on-image text-[4.5cqmin] font-medium whitespace-nowrap">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-[8.5cqmin] flex flex-col gap-[1.5cqmin]">
          <span className="text-pnl-on-image-muted text-[3.83cqmin]">
            Total PnL
          </span>
          <span className="text-pnl-on-image text-[10.67cqmin] leading-none font-semibold whitespace-nowrap">
            0.0000 ETH
          </span>
          <span className="text-pnl-on-image-muted text-[4.5cqmin]">
            $0.00
          </span>
        </div>
      </div>
    </>
  )
}

type CardPreviewProps = {
  format: Format
  name: string
  image: CardImage | null
  position: ImagePosition
  onPosition: (next: ImagePosition) => void
  price: number | null
  priceLoading: boolean
}

export function CardPreview({
  format,
  name,
  image,
  position,
  onPosition,
  price,
  priceLoading,
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
    onPosition({
      x: Math.min(
        100,
        Math.max(0, start.position.x - ((event.clientX - start.clientX) / rect.width) * 100),
      ),
      y: Math.min(
        100,
        Math.max(0, start.position.y - ((event.clientY - start.clientY) / rect.height) * 100),
      ),
    })
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const overlay: OverlayProps = { name, price, priceLoading }

  return (
    <div
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
            No collection image
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
