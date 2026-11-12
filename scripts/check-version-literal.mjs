import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// The app reports one version, and `package.json` holds it. A literal beside it
// is what this catches: the sidebar printed `v1.0.0` for months while the
// manifest said `0.1.2`, and no check noticed.
const LITERAL = /\bv\d+\.\d+\.\d+\b/
const SOURCE_DIR = 'src'
const SOURCE_FILE = /\.(ts|tsx)$/

const offenders = []

for (const file of walk(SOURCE_DIR)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (LITERAL.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
  })
}

if (offenders.length === 0) {
  console.log(`${SOURCE_DIR}/ reports no hardcoded version literal`)
  process.exit(0)
}

for (const offender of offenders) console.error(offender)
console.error(
  'Report the version from `__APP_VERSION__`, which vite.config.ts injects from package.json.'
)
process.exit(1)

function walk(directory) {
  const found = []
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry)
    if (statSync(target).isDirectory()) {
      found.push(...walk(target))
    } else if (SOURCE_FILE.test(entry)) {
      found.push(target)
    }
  }
  return found
}
