import { useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'

export function TokenImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
        <ImageIcon aria-hidden className="text-muted-foreground size-3.5" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="bg-muted size-7 shrink-0 rounded-md object-cover"
    />
  )
}
