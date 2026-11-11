// Addresses arrive from the chain, from the store and from a typed field, so their letter
// case disagrees. Comparing two of them without normalising is how a wallet that exists
// reads as missing, and how a key that signs as the wrong account passes a guard.

export function addressKey(address: string): string {
  return address.toLowerCase()
}

export function sameAddress(left: string, right: string): boolean {
  return addressKey(left) === addressKey(right)
}
