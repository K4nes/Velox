/**
 * One `GET /drops/{slug}` body, as far as the app reads it: the contract,
 * supply and stage schedule. Stage ids are matched against the eligibility
 * response after the dashes are removed.
 */
export type DropStageFixtureOptions = {
  uuid: string
  label?: string
  stageType?: string
  priceWei?: string
  maxPerWallet?: string
  startTime?: string
  endTime?: string
}

export type DropFixtureOptions = {
  slug: string
  contract: string
  name?: string
  chain?: string
  dropType?: string
  isMinting?: boolean
  maxSupply?: string
  totalSupply?: string
  stages?: DropStageFixtureOptions[]
  activeStage?: DropStageFixtureOptions | null
  nextStage?: DropStageFixtureOptions | null
}

function stageFixture(options: DropStageFixtureOptions) {
  return {
    uuid: options.uuid,
    stage_type: options.stageType ?? 'public',
    label: options.label ?? 'Public',
    price: options.priceWei ?? '0',
    max_per_wallet: options.maxPerWallet ?? '1',
    start_time: options.startTime ?? '',
    end_time: options.endTime ?? '',
  }
}

export function dropFixture(options: DropFixtureOptions) {
  const {
    slug,
    contract,
    name = 'Mock Drop',
    chain = 'robinhood',
    dropType = 'seadrop_v1_erc721',
    isMinting = true,
    maxSupply = '100',
    totalSupply = '1',
    stages = [],
    activeStage = null,
    nextStage = null,
  } = options

  return {
    collection_slug: slug,
    collection_name: name,
    chain,
    contract_address: contract,
    drop_type: dropType,
    is_minting: isMinting,
    max_supply: maxSupply,
    total_supply: totalSupply,
    active_stage: activeStage === null ? null : stageFixture(activeStage),
    next_stage: nextStage === null ? null : stageFixture(nextStage),
    stages: stages.map(stageFixture),
  }
}
