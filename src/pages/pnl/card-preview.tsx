import { useRef, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'

export const formats = ['Landscape', 'Portrait'] as const

export type Format = (typeof formats)[number]

export type CardImage = { id: string; src: string; label: string }

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

  return (
    <div
      className={cn(
        '@container relative overflow-hidden rounded-xl',
        format === 'Landscape'
          ? 'aspect-[959/600] w-[min(100%,calc((100svh-16rem)*959/600))] max-w-3xl'
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="pointer-events-none absolute inset-x-5 top-5 flex items-start justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:top-3">
        <span className="bg-pnl-overlay text-pnl-on-image rounded-lg px-3 py-2 text-base font-medium whitespace-nowrap">
          {name === '' ? 'No collection' : name}
        </span>
        <span
          className={cn(
            'bg-pnl-overlay text-pnl-on-image-muted rounded-lg px-2.5 py-1 text-xs whitespace-nowrap',
            priceLoading && 'animate-pulse',
          )}
        >
          ETH/USDT {price === null ? '—' : currency.format(price)}
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 @max-[420px]:inset-x-3 @max-[420px]:bottom-3">
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
