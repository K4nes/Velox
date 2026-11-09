import { buildMintTransaction } from '@/lib/opensea'
import type { MintTransaction } from '@/lib/opensea'
import { sendTransaction } from '@/lib/tx'
import type { TxGas } from '@/lib/tx'
import type { StoredWallet } from '@/lib/wallets'

export async function mintForWallet(input: {
  slug: string
  wallet: StoredWallet
  quantity: number
  gas: TxGas
  transaction?: MintTransaction
  shouldAbort?: () => boolean
}): Promise<{ txHash: string; chain: string }> {
  const transaction =
    input.transaction ??
    (await buildMintTransaction(
      input.slug,
      input.wallet.address,
      input.quantity
    ))

  return sendTransaction({
    wallet: input.wallet,
    chainSlug: transaction.chain,
    to: transaction.to as `0x${string}`,
    data: transaction.data as `0x${string}`,
    value: BigInt(transaction.value),
    gas: input.gas,
    shouldAbort: input.shouldAbort,
  })
}
