import { existsSync } from 'node:fs'
import { join } from 'node:path'

// `npm run build` resolves `tsc` and `vite` through PATH. With `node_modules`
// absent, npm falls back to a globally installed copy, so the build can go green
// against a toolchain the lockfile never pinned, and the browser lane then dies
// with `APP_UNREACHABLE`. Both gates refuse to start instead.

const bin = join(process.cwd(), 'node_modules', '.bin')
const missing = ['tsc', 'vite'].filter(
  (name) => !existsSync(join(bin, name)) && !existsSync(join(bin, `${name}.cmd`))
)

if (missing.length === 0) {
  process.exit(0)
}

console.error(
  `node_modules/.bin has no ${missing.join(' and ')}; run \`npm ci\` so the gate uses the repo's own toolchain`
)
process.exit(1)
