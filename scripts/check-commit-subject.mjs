const TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'test',
  'docs',
  'style',
  'build',
  'ci',
  'chore',
]

// The PR title becomes the squash commit subject, so it is what COMMIT.md
// governs. Read it from the environment, never from a shell interpolation.
const subject = process.env.PR_TITLE ?? process.argv[2] ?? ''

const failures = []
const match = /^([a-z]+)(\([a-z0-9-]+\))?: .+$/.exec(subject)

if (!subject) {
  failures.push('no subject to check: set PR_TITLE or pass one as an argument')
} else if (!match) {
  failures.push('expected "type(scope): description" with a lowercase type')
} else if (!TYPES.includes(match[1])) {
  failures.push(`"${match[1]}" is not one of: ${TYPES.join(', ')}`)
}
if (subject.length > 72) {
  failures.push(`${subject.length} characters, the limit is 72`)
}
if (subject.endsWith('.')) {
  failures.push('ends with a period')
}

if (failures.length === 0) {
  console.log(`commit subject ok: ${subject}`)
  process.exit(0)
}

for (const failure of failures) {
  console.error(`${failure}: ${subject}`)
}
process.exit(1)
