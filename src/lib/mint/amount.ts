// No runtime `@/` import: `npm run test:release` loads this file with node type
// stripping. A type-only import is erased, so the alias never resolves at runtime.

import { formatUnits } from 'viem'
import type { DropStage } from '@/lib/opensea/index'

// The amount is carried in base units. A provider that states a currency says how to
// read it; without one the stage keeps the 18-decimal ETH reading it always had.
export function amountLabel(wei: bigint, stage: DropStage | null): string {
  const decimals = stage?.currency?.decimals ?? 18
  const symbol = stage?.currency?.symbol ?? 'ETH'
  if (wei === 0n) return `0 ${symbol}`
  // Round before comparing: 0.00003 ETH prints four places as `0.0000`, which
  // reads as a free mint. The comparison used to look at the unrounded value.
  const shown = Number(formatUnits(wei, decimals)).toFixed(4)
  return Number(shown) === 0 ? `<0.0001 ${symbol}` : `${shown} ${symbol}`
}
