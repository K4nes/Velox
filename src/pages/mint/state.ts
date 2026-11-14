// Type imports only: `npm run test:release` loads this file with node type stripping.

import type { PreparedMint } from '@/lib/mint/run-mint'
import type { Task, WalletRun } from '@/lib/mint/mint-task'
import type { EligibilitySnapshotPayload } from '@/lib/mint/snapshots'

export type MintTasksState = {
  tasks: Task[]
  activeId: string | null
  runs: Record<string, WalletRun[]>
  runningIds: string[]
  preparedMints: Map<string, PreparedMint>
}

export function createMintTasksState(task: Task): MintTasksState {
  return {
    tasks: [task],
    activeId: null,
    runs: {},
    runningIds: [],
    preparedMints: new Map(),
  }
}

export type MintEligibilityState = {
  walletIds: string[]
  url: string
  checked: EligibilitySnapshotPayload | null
  error: string | null
  running: boolean
}

export function createMintEligibilityState(): MintEligibilityState {
  return {
    walletIds: [],
    url: '',
    checked: null,
    error: null,
    running: false,
  }
}
