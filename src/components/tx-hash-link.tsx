import { txUrl } from '@/config/chains'
import { openExternal } from '@/lib/external-open'

// A chain with no explorer keeps the label and loses the link: the hash is real,
// the page that would show it is not.
export function TxHashLink({
  chain,
  txHash,
}: {
  chain: string | null | undefined
  txHash: string
}) {
  const url = chain ? txUrl(chain, txHash) : null

  if (url === null) {
    return <span className="text-muted-foreground text-xs">Tx Hash</span>
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Tx Hash ${txHash.slice(0, 10)}, opens in new tab`}
      className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        openExternal(url)
      }}
    >
      Tx Hash
    </a>
  )
}
