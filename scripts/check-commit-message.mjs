import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

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

const NEEDS_TEST = new Set(['feat', 'fix', 'perf'])

// COMMIT.md governs every commit, not just the PR title. Merge commits are the
// one exemption, so they pass through unparsed.
export function checkCommitMessage(message) {
  const failures = []
  const [subject = '', ...body] = message.split('\n')
  const title = subject.trim()

  if (title.startsWith('Merge ')) return failures

  const match = /^([a-z]+)(\([a-z0-9-]+\))?!?: .+$/.exec(title)
  if (!match) {
    failures.push('expected "type(scope): description" with a lowercase type')
  } else if (!TYPES.includes(match[1])) {
    failures.push(`"${match[1]}" is not one of: ${TYPES.join(', ')}`)
  }
  if (title.length > 72) {
    failures.push(`${title.length} characters, the limit is 72`)
  }
  if (title.endsWith('.')) {
    failures.push('ends with a period')
  }
  if (match && NEEDS_TEST.has(match[1])) {
    const hasEvidence = body.some((line) =>
      /^(Test|No test): .+/.test(line.trim())
    )
    if (!hasEvidence) {
      failures.push(
        'feat, fix and perf need a "Test: <path>" or "No test: <reason>" footer'
      )
    }
  }

  return failures
}

export function checkCommitMessages(entries) {
  const failures = []
  for (const entry of entries) {
    for (const failure of checkCommitMessage(entry.message)) {
      failures.push(`${entry.sha}: ${failure}`)
    }
  }
  return failures
}

function readEntries(base, head) {
  const output = execFileSync(
    'git',
    ['log', '--format=%h%x1f%B%x1e', `${base}..${head}`],
    { encoding: 'utf8' }
  )
  return output
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = '', ...message] = entry.split('\x1f')
      return { sha, message: message.join('\x1f').trim() }
    })
}

function main() {
  const base = process.env.BASE_SHA ?? process.argv[2]
  const head = process.env.HEAD_SHA ?? process.argv[3] ?? 'HEAD'
  if (!base) {
    console.error('set BASE_SHA or pass a base commit')
    process.exit(1)
  }

  const entries = readEntries(base, head)
  if (entries.length === 0) {
    console.log('no commits in range; nothing to check')
    process.exit(0)
  }

  const failures = checkCommitMessages(entries)
  if (failures.length === 0) {
    console.log(`commit messages ok: ${entries.length}`)
    process.exit(0)
  }

  for (const failure of failures) console.error(failure)
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
