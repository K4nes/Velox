import { mainnet } from 'viem/chains'
import { getEnsAddress, normalize } from 'viem/ens'
import { clientFor } from '@/lib/tx'

export async function resolveEnsAddress(
  name: string
): Promise<`0x${string}` | null> {
  let normalized: string
  try {
    normalized = normalize(name)
  } catch {
    return null
  }

  const client = await clientFor('ethereum')
  // `clientFor` builds a bare chain with no ENS contract, and viem throws rather
  // than guess a resolver, so the mainnet resolver goes in explicitly.
  const address = await getEnsAddress(client, {
    name: normalized,
    universalResolverAddress: mainnet.contracts.ensUniversalResolver.address,
  })

  return address
}
