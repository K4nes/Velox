import { existsSync } from 'node:fs'
import { join } from 'node:path'

// A live case skips itself when its env is missing, so the lane can report green
// while running nothing. This preflight turns that skip into a failure instead.

const REQUIRED = [
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
]

// Git-ignored, and the only place the values are allowed to sit.
const envFile = join(process.cwd(), '.env.e2e.local')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

const missing = REQUIRED.filter((name) => {
  const value = process.env[name]
  return value === undefined || value === ''
})

if (missing.length === 0) {
  process.exit(0)
}

console.error(
  `the live lane would skip every case; missing ${missing.join(', ')}. Put them in .env.e2e.local at the repo root, or run one file with \`npx e2e run --config e2e.live.config.ts <path>\``
)
process.exit(1)
