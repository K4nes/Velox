// No imports here: `node --test` loads this file with type stripping, so it cannot pull
// React or the `@/` alias.

export type LiveRead = { live: () => boolean }

export type ReadEpoch = {
  open(): LiveRead
  drop(): void
}

export function createReadEpoch(): ReadEpoch {
  let at = 0
  return {
    open() {
      at += 1
      const opened = at
      return { live: () => at === opened }
    },
    drop() {
      at += 1
    },
  }
}

export type PageFlow = 'scan' | 'run'

export type PageStore<S extends object> = {
  get(): S
  set(next: Partial<S>): void
  subscribe(listener: () => void): () => void
  open(flow: PageFlow): LiveRead
  dropReads(): void
  readonly retained: boolean
}

// A retained store lives at module scope and outlives the page that owns it. A per-mount
// store is closed on unmount, which drops its in-flight reads exactly as the page used to.
export function createPageStore<S extends object>(
  initial: S,
  options?: { retained?: boolean }
): PageStore<S> {
  const declared = new Set(Object.keys(initial))
  const listeners = new Set<() => void>()
  const flowEpochs = new Map<PageFlow, ReadEpoch>()
  let state = initial

  function set(next: Partial<S>) {
    for (const key of Object.keys(next)) {
      if (!declared.has(key)) {
        throw new Error(`page store does not hold ${key}`)
      }
    }
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }

  return {
    get: () => state,
    set,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open(flow) {
      let epoch = flowEpochs.get(flow)
      if (!epoch) {
        epoch = createReadEpoch()
        flowEpochs.set(flow, epoch)
      }
      return epoch.open()
    },
    dropReads() {
      for (const epoch of flowEpochs.values()) epoch.drop()
    },
    retained: options?.retained ?? false,
  }
}
