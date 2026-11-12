import { readFileSync } from 'node:fs'
import { diffLock } from './lockfile.mjs'

const [manifestPath = 'package.json', lockPath = 'package-lock.json'] = process.argv.slice(2)

const problems = diffLock({ manifest: read(manifestPath), lock: read(lockPath) })

if (problems.length === 0) {
  console.log(`${lockPath} matches ${manifestPath}`)
  process.exit(0)
}

for (const problem of problems) {
  console.error(problem)
}
console.error('Run `npm install` to reconcile the lock with the manifest before pushing.')
process.exit(1)

function read(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (failure) {
    console.error(`${path} is not readable JSON: ${failure.message}`)
    process.exit(1)
  }
}
