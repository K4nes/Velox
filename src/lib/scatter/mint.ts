import { chainBySlug } from '@/config/chains'
import type { DropInfo, MintTransaction } from '@/lib/opensea/index'
import { ScatterError } from '@/lib/scatter/error'
import { buildScatterMintTransaction } from '@/lib/scatter/index'

// The build states its target, its value and its calldata; everything else comes from
// the drop the check produced. The chain is the drop's own slug, never a second read of
// the collection, and the list identifier is the stage the operator picked.
export async function buildScatterMint(input: {
  drop: DropInfo
  listId: string
  minter: string
  quantity: number
}): Promise<MintTransaction> {
  const chain = chainBySlug(input.drop.chain)
  if (!chain) {
    throw new ScatterError(
      422,
      'unsupported-chain',
      `Velox cannot sign for ${input.drop.chain}.`
    )
  }

  const stage = input.drop.stages.find((entry) => entry.uuid === input.listId) ?? null
  const transaction = await buildScatterMintTransaction(
    {
      collectionAddress: input.drop.contractAddress,
      chainId: chain.chainId,
      minterAddress: input.minter,
      listId: input.listId,
      quantity: input.quantity,
      tokenId: input.drop.tokenId,
    },
    stage
  )

  return {
    chain: input.drop.chain,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
    allowances: transaction.allowances,
  }
}
