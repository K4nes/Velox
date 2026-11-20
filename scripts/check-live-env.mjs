import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { liveEnvProblems } from './live-env.mjs'

// A live case skips itself when its env is missing, so the lane can report green
// while running nothing. This preflight turns that skip into a failure instead,
// for the lane the caller names.

// Git-ignored, and the only place the values are allowed to sit.
const envFile = join(process.cwd(), '.env.e2e.local')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

const lane = process.argv[2] ?? 'live'
const problems = liveEnvProblems(lane, process.env)

if (problems.length === 0) {
  process.exit(0)
}

console.error(
  `${problems.join('\n')}. Put the values in .env.e2e.local at the repo root, or run one file with \`npx e2e run --config e2e.live.config.ts <path>\``
)
process.exit(1)
