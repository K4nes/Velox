import { useCallback, useEffect, useRef } from 'react'

export type LiveRead = { live: () => boolean }

// One epoch for every async read the calling hook starts. `open()` bumps it, so
// opening a run drops the ones before it; `abort()` bumps it to drop whatever is
// in flight; unmount bumps it, so a read that lands late is simply not live.
export function useLiveRead(): { open: () => LiveRead; abort: () => void } {
  const epoch = useRef(0)

  useEffect(() => {
    return () => {
      epoch.current += 1
    }
  }, [])

  const open = useCallback((): LiveRead => {
    epoch.current += 1
    const at = epoch.current
    return { live: () => epoch.current === at }
  }, [])

  const abort = useCallback(() => {
    epoch.current += 1
  }, [])

  return { open, abort }
}
