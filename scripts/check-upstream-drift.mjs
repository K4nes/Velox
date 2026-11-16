import { execFileSync } from 'node:child_process'

// A worktree behind its upstream runs every later gate against code the reviewer
// will not see. That happened: a plan for issue #126 was written against a tree
// four commits old, missing the resolver the fix was built on, and nothing said so
// until the diff was read.
//
// The check fails rather than warns, because a warning on a green gate is ignored.
// `VELOX_ALLOW_BEHIND=1` is the deliberate escape, for comparing against an old
// tree on purpose, and `VELOX_DRIFT_AGAINST=<ref>` names the branch to compare, so
// the check can be exercised against a ref that is genuinely behind.

const ALLOW = process.env.VELOX_ALLOW_BEHIND === '1'

const target = process.env.VELOX_DRIFT_AGAINST ?? upstream()
if (target === null) {
  console.log('upstream drift: nothing to compare against')
  process.exit(0)
}

const behind = Number(git(['rev-list', '--count', `HEAD..${target}`]) ?? '0')
if (!Number.isFinite(behind) || behind === 0) {
  console.log(`upstream drift: ${target} is not ahead`)
  process.exit(0)
}

const detail = `HEAD is ${behind} commit(s) behind ${target}`
if (ALLOW) {
  console.log(`upstream drift: ${detail}, allowed by VELOX_ALLOW_BEHIND`)
  process.exit(0)
}

console.error(`upstream drift: ${detail}`)
console.error('A gate run on this tree says nothing about the branch under review.')
console.error(`Fast-forward first: git merge --ff-only ${target}`)
process.exit(1)

// The branch's own upstream, or the remote default branch when it has none. A
// managed worktree has no upstream, which is exactly the case this guards.
function upstream() {
  const own = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (own !== null) return own.trim()

  const head = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (head !== null) return head.trim()

  return git(['rev-parse', '--verify', '--quiet', 'origin/main']) === null
    ? null
    : 'origin/main'
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}
