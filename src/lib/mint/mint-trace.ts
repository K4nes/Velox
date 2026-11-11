// Timestamps for the armed fire path. The armed run otherwise records only the
// mint's block, which cannot separate a late poll from a slow pre-flight.
export type MintTraceEvent =
  | {
      at: number
      wall: number
      kind: 'poll'
      taskId: string
      chainMs: number
    }
  | {
      at: number
      wall: number
      kind: 'drops'
      slug: string
      activeStageUuid: string | null
    }
  | { at: number; wall: number; kind: 'check-start'; taskId: string }
  | {
      at: number
      wall: number
      kind: 'check-end'
      taskId: string
      ok: boolean
    }
  | {
      at: number
      wall: number
      kind: 'calldata'
      slug: string
      minter: string
      quantity: number
    }
  | {
      at: number
      wall: number
      kind: 'send-raw'
      walletAddress: string
      txHash: string
      ok: boolean
    }

type MintTraceInput =
  | { kind: 'poll'; taskId: string; chainMs: number }
  | { kind: 'drops'; slug: string; activeStageUuid: string | null }
  | { kind: 'check-start'; taskId: string }
  | { kind: 'check-end'; taskId: string; ok: boolean }
  | { kind: 'calldata'; slug: string; minter: string; quantity: number }
  | {
      kind: 'send-raw'
      walletAddress: string
      txHash: string
      ok: boolean
    }

const LIMIT = 500
const events: MintTraceEvent[] = []

export function traceMint(input: MintTraceInput): void {
  if (events.length >= LIMIT) events.splice(0, events.length - LIMIT + 1)
  events.push({ ...input, at: performance.now(), wall: Date.now() })
}

export function snapshotMintTrace(): MintTraceEvent[] {
  return [...events]
}

export function clearMintTrace(): void {
  events.length = 0
}

export type MintTraceApi = {
  snapshot: () => MintTraceEvent[]
  clear: () => void
}

declare global {
  interface Window {
    __veloxMintTrace?: MintTraceApi
  }
}

if (typeof window !== 'undefined') {
  window.__veloxMintTrace = {
    snapshot: snapshotMintTrace,
    clear: clearMintTrace,
  }
}
