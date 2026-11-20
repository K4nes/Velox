// A live case skips itself when its env is missing, so a lane can report green while
// running nothing. This table is what each lane's cases declare, and the preflight in
// check-live-env.mjs turns a gap into a failure instead of a skip.

export const LANES = {
  live: [
    'E2E_WALLET_KEY',
    'E2E_WALLET_LABEL',
    'E2E_WALLET_FOLDER',
    'E2E_RH_RPC_URL',
    'E2E_OPEN_SEA_KEY',
    'E2E_OPENSEA_API_URL',
    'E2E_PORTFOLIO_SLUG',
    'E2E_PORTFOLIO_CHAIN',
    'E2E_PNL_SLUG',
    'E2E_PNL_CHAIN',
    'E2E_CMC_KEY',
    'E2E_ELIGIBILITY_COLLECTION_URL',
    'E2E_ELIGIBILITY_EXPECT',
  ],
  // Every case in tests/mint/live, gas ones included. `scatter.e2e.ts` reads and needs
  // no value; the others state their gate in their own `skip` condition.
  mint: [
    'E2E_ALLOW_MINT',
    'E2E_DROP_SLUG',
    'E2E_WALLET_KEY',
    'E2E_WALLET_LABEL',
    'E2E_WALLET_FOLDER',
    'E2E_RH_RPC_URL',
    'E2E_OPEN_SEA_KEY',
    'E2E_SCATTER_ERC20_SLUG',
    'E2E_SCATTER_ERC20_RPC_URL',
  ],
}

/** The reason the lane cannot run every case, or an empty list when it can. */
export function liveEnvProblems(lane, env) {
  const required = LANES[lane]
  if (required === undefined) {
    return [
      `unknown lane "${lane}"; name one of ${Object.keys(LANES).join(', ')}`,
    ]
  }

  const missing = required.filter((name) => (env[name] ?? '') === '')
  if (missing.length > 0) {
    return [
      `the ${lane} lane would skip every case; missing ${missing.join(', ')}`,
    ]
  }

  // A present but disabled gate reads like a configured lane and still runs no gas case.
  if (lane === 'mint' && env.E2E_ALLOW_MINT !== '1') {
    return ['the mint lane would skip every gas case; set E2E_ALLOW_MINT=1']
  }

  return []
}
