import { readFileSync } from 'node:fs'

// `npm install` has no script of its own, so it is a table row without a
// package.json entry. Any other mismatch means the two lists have drifted.
const INSTALL_ROW = 'install'

const scripts = Object.keys(readScripts())
const rows = [
  ...readFileSync('AGENTS.md', 'utf8').matchAll(/^\| `npm (?:run )?([a-z0-9:]+)`/gm),
].map((match) => match[1])

function readScripts() {
  try {
    return JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {}
  } catch (failure) {
    console.error(`package.json does not hold readable scripts: ${failure.message}`)
    process.exit(1)
  }
}

const missing = scripts.filter((name) => !rows.includes(name))
const stale = rows.filter(
  (name) => name !== INSTALL_ROW && !scripts.includes(name)
)

if (missing.length === 0 && stale.length === 0) {
  console.log(`AGENTS.md command table matches all ${scripts.length} scripts`)
  process.exit(0)
}

for (const name of missing) {
  console.error(`AGENTS.md has no row for: npm run ${name}`)
}
for (const name of stale) {
  console.error(`AGENTS.md names a script that does not exist: npm run ${name}`)
}
process.exit(1)
