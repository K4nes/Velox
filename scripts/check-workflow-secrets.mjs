import { readFileSync, readdirSync } from 'node:fs'

// A secret in a job-level `env` reaches every step, `npm ci` included, where
// any install script can read it. The signing secrets belong to the steps that
// use them, so the check fails on a `secrets.` reference above `steps:`.
const WORKFLOWS = '.github/workflows'
const SECRET = /secrets\.[A-Za-z0-9_]+/
const JOB = /^ {2}[A-Za-z0-9_-]+:$/
const STEPS = /^\s+steps:$/

const offenders = []

for (const file of readdirSync(WORKFLOWS)) {
  if (!file.endsWith('.yml')) continue
  const path = `${WORKFLOWS}/${file}`
  let inSteps = false
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim().startsWith('#')) return
      if (JOB.test(line)) inSteps = false
      if (STEPS.test(line)) inSteps = true
      if (!inSteps && SECRET.test(line)) {
        offenders.push(`${path}:${index + 1}: ${line.trim()}`)
      }
    })
}

if (offenders.length === 0) {
  console.log(`${WORKFLOWS}/ keeps every secret on the step that uses it`)
  process.exit(0)
}

for (const offender of offenders) console.error(offender)
console.error("Move the secret into the `env:` of the step that reads it.")
process.exit(1)
