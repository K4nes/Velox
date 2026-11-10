import { txUrl } from '@/config/chains'

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
    >
      Tx Hash
    </a>
  )
}
