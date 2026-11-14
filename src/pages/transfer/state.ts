// Type imports only: `npm run test:release` loads this file with node type stripping.

import { EMPTY_HOLDINGS } from '../../lib/inventory/holdings-fields.ts'
import type { TransferRunFields } from '@/hooks/run/use-transfer-run'
import type { TransferScanFields } from '@/hooks/scan/use-transfer-scan'

export type TransferState = TransferScanFields & TransferRunFields

export function createTransferState(): TransferState {
  return {
    ...EMPTY_HOLDINGS,
    selectedKeys: [],
    probeState: { key: '', probes: new Map() },
    spent: new Map(),
    destinationText: '',
    resolved: null,
    history: new Map(),
    running: false,
    error: null,
    progress: null,
  }
}
