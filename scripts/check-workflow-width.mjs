import { readFileSync, readdirSync } from 'node:fs'

// A workflow is read in a diff as often as it runs, so its lines stay inside
// the same 80 columns as the rest of the repository. `verify.yml` is the
// widest file today at exactly 80, and nothing used to hold the next one there.
const WORKFLOWS = '.github/workflows'
const LIMIT = 80

const offenders = []

for (const file of readdirSync(WORKFLOWS)) {
  if (!file.endsWith('.yml')) continue
  const path = `${WORKFLOWS}/${file}`
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.length > LIMIT) {
        offenders.push(`${path}:${index + 1}: ${line.length} columns`)
      }
    })
}

if (offenders.length === 0) {
  console.log(`${WORKFLOWS}/ keeps every line within ${LIMIT} columns`)
  process.exit(0)
}

for (const offender of offenders) console.error(offender)
console.error(`Wrap the line: the limit is ${LIMIT} columns.`)
process.exit(1)
