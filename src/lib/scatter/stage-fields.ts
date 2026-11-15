// No runtime imports: `npm run test:release` loads this file with node type stripping.

import type { ScatterMintList } from './index'

// `0x000…000` is the chain's native currency. A list priced in it carries the chain's
// symbol; every other list carries its own.
export const SCATTER_NATIVE_CURRENCY =
  '0x0000000000000000000000000000000000000000'

type CurrencyFields = Pick<
  ScatterMintList,
  'currencySymbol' | 'currencyAddress' | 'decimals'
>

// Scatter states a blank symbol for a token it has no ticker for. The amount still
// has the token's decimals, so the label names the token by address instead of
// reading its base units as 18-decimal ETH. An address it also omits falls back to a
// unit count, which is honest about the magnitude.
export function stageCurrency(
  list: CurrencyFields,
  nativeSymbol: string
): { symbol: string; decimals: number } {
  const symbol =
    list.currencySymbol !== ''
      ? list.currencySymbol
      : list.currencyAddress === SCATTER_NATIVE_CURRENCY
        ? nativeSymbol
        : list.currencyAddress !== ''
          ? `${list.currencyAddress.slice(0, 6)}…${list.currencyAddress.slice(-4)}`
          : 'tokens'
  return { symbol, decimals: list.decimals }
}

// Absent and 1 both mean one NFT per quantity step. OpenSea never sets it.
export function stageUnitSize(unitSize: number): number | undefined {
  return unitSize > 1 ? unitSize : undefined
}
