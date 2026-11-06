import { Server } from 'lucide-react'
import { cn } from 'cn'

// Iconify hosts the real provider marks; the lucide fallback keeps a custom or
// unknown provider from rendering an empty tile.
const imageMarks: Record<string, string> = {
  opensea: 'https://api.iconify.design/simple-icons/opensea.svg?color=%232081E2',
  coinmarketcap:
    'https://api.iconify.design/simple-icons/coinmarketcap.svg?color=%233861FB',
  'rpc:alchemy':
    'https://api.iconify.design/simple-icons/alchemy.svg?color=%230a0a0a',
  'rpc:ankr': 'https://api.iconify.design/token-branded/ankr.svg',
}

type ProviderMarkProps = { id: string; size?: 'sm' | 'md' }

// Only the monochrome Alchemy mark is inverted for dark mode; the colored marks
// lose their brand hue when inverted.
const darkInvert: Record<string, true> = { 'rpc:alchemy': true }

export function ProviderMark({ id, size = 'md' }: ProviderMarkProps) {
  const src = imageMarks[id]
  const iconClass = size === 'sm' ? 'size-3.5' : 'size-5'

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border bg-background dark:bg-transparent',
        size === 'sm' ? 'size-6' : 'size-[42px]'
      )}
    >
      {src === undefined ? (
        <Server
          className={cn('text-muted-foreground', iconClass)}
          aria-hidden
        />
      ) : (
        <img
          src={src}
          alt=""
          className={cn(iconClass, darkInvert[id] === true && 'dark:invert')}
          // A registry URL that stops answering leaves the tile blank instead
          // of the browser's broken-image glyph.
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden'
          }}
        />
      )}
    </span>
  )
}
