import { useEffect, useState, useSyncExternalStore } from 'react'

import { createPageStore } from '@/lib/core/page-store'
import type { PageStore } from '@/lib/core/page-store'

export function usePageStore<S extends object>(store: PageStore<S>): S {
  return useSyncExternalStore(store.subscribe, store.get)
}

// The store's lifetime decides whether its state survives the page. A retained store is
// module scope, so this only closes the per-mount one: a read that resolves after that
// must not write, and its toast must not land on whatever page the operator moved to.
// React StrictMode's simulated unmount closes it too, which is harmless because no read
// is open yet.
export function usePageStoreScope<S extends object>(
  given: PageStore<S> | undefined,
  initial: S
): PageStore<S> {
  const [local] = useState(() => createPageStore(initial))

  useEffect(() => {
    if (given) return
    return () => {
      local.dropReads()
    }
  }, [given, local])

  return given ?? local
}
