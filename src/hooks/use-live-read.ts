import { useCallback, useEffect, useState } from 'react'

import { createReadEpoch } from '@/lib/core/page-store'
import type { LiveRead } from '@/lib/core/page-store'

// One epoch for every async read the calling hook starts. `open()` bumps it, so
// opening a run drops the ones before it; `abort()` bumps it to drop whatever is
// in flight; unmount bumps it, so a read that lands late is simply not live.
export function useLiveRead(): { open: () => LiveRead; abort: () => void } {
  const [epoch] = useState(createReadEpoch)

  useEffect(() => {
    return () => {
      epoch.drop()
    }
  }, [epoch])

  const open = useCallback((): LiveRead => epoch.open(), [epoch])
  const abort = useCallback(() => epoch.drop(), [epoch])

  return { open, abort }
}
