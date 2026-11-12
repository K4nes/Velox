// The lock is the only place a dependency resolution lives. A dependency that
// reaches `package.json` alone still installs on the machine that ran `npm
// install`, and fails on a clean `npm ci`, which is how a rebase finds it.

const KINDS = ['dependencies', 'devDependencies']

export function diffLock({ manifest, lock }) {
  const root = lock.packages?.[''] ?? {}
  const problems = []

  for (const kind of KINDS) {
    const declared = manifest[kind] ?? {}
    const locked = root[kind] ?? {}

    for (const [name, range] of Object.entries(declared)) {
      if (!(name in locked)) {
        problems.push(`${kind}: ${name} is in package.json and not in the lock`)
        continue
      }
      if (locked[name] !== range) {
        problems.push(`${kind}: ${name} is ${range} in package.json and ${locked[name]} in the lock`)
      }
      if (!lock.packages?.[`node_modules/${name}`]) {
        problems.push(`${kind}: ${name} has no resolved entry in the lock`)
      }
    }

    for (const name of Object.keys(locked)) {
      if (!(name in declared)) {
        problems.push(`${kind}: ${name} is in the lock and not in package.json`)
      }
    }
  }

  return problems
}
