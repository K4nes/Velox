import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { writeClipboardText } from '@/lib/clipboard/clipboard'

function copyOrderHash(orderHash: string) {
  void writeClipboardText(orderHash).then(
    () => toast.success('Order hash copied'),
    () => toast.error('Could not copy the order hash')
  )
}

// An order hash names an order, not a transaction. It is never rendered as an
// explorer link: that URL would be built from a hash the explorer does not index.
export function OrderHashNote({
  orderHash,
  openseaUrl,
  tokenId,
}: {
  orderHash: string
  openseaUrl: string
  tokenId: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        title={orderHash}
        aria-label={`Copy order hash ${orderHash.slice(0, 10)}`}
        className="text-muted-foreground hover:text-foreground truncate font-mono text-[11px] underline-offset-2 hover:underline"
        onClick={() => copyOrderHash(orderHash)}
      >
        {orderHash.slice(0, 8)}…
      </button>
      {openseaUrl === '' ? null : (
        <a
          href={openseaUrl}
          target="_blank"
          rel="noreferrer"
          title="Open the asset page on OpenSea"
          aria-label={`Open token #${tokenId} on OpenSea in a new tab`}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <ExternalLink className="size-3" />
        </a>
      )}
    </span>
  )
}
