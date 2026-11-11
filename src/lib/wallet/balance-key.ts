import { addressKey } from '@/lib/wallet/address'

declare const balanceKeyBrand: unique symbol

// A cached balance is keyed by its chain and its address together. Only
// balanceKey builds that key, so an address in the wrong case cannot reach the
// cache as a miss and leave an old number on screen.
export type BalanceKey = string & { readonly [balanceKeyBrand]: true }

export type BalanceMap = Map<BalanceKey, bigint>

export function balanceKey(chainSlug: string, address: string): BalanceKey {
  return `${chainSlug}:${addressKey(address)}` as BalanceKey
}
