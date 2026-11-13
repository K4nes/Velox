export type RunKind = 'listing' | 'cancel' | 'sale' | 'swap' | 'transfer'

export function runKindLabel(kind: RunKind): string {
  switch (kind) {
    case 'listing':
      return 'A bulk sell run is still in progress'
    case 'cancel':
      return 'A cancel run is still in progress'
    case 'sale':
      return 'An instant sell run is still in progress'
    case 'swap':
      return 'A swap run is still in progress'
    case 'transfer':
      return 'A transfer run is still in progress'
  }
}

export type RunSlot = {
  kind: RunKind
  aborted: boolean
  done: Promise<void>
  settle: () => void
}

export type SlotClaim =
  | { kind: 'acquired'; slot: RunSlot }
  | { kind: 'busy'; running: RunKind }
  | { kind: 'stale' }

// A run keeps submitting after its page unmounts, so the guard lives outside
// every hook that claims it. A second flow waits for an abandoned run to settle
// before it starts, because a submit already in flight still lands.
let active: RunSlot | null = null

export async function claimRunSlot(
  kind: RunKind,
  onWait?: () => void,
  isStale?: () => boolean
): Promise<SlotClaim> {
  let notified = false

  while (true) {
    if (isStale?.()) return { kind: 'stale' }
    if (!active) break

    if (!active.aborted) {
      return { kind: 'busy', running: active.kind }
    }

    if (!notified) {
      notified = true
      onWait?.()
    }
    await active.done
  }

  // The project's TS lib predates Promise.withResolvers.
  let settle = () => {}
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  const slot: RunSlot = { kind, aborted: false, done, settle }
  active = slot

  return { kind: 'acquired', slot }
}

export function abortRunSlot(slot: RunSlot): void {
  slot.aborted = true
}

export function releaseRunSlot(slot: RunSlot): void {
  slot.settle()
  if (active === slot) active = null
}
