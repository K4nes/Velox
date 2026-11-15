import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

// The navigation retro's numbers came from one-off scripts that are gone. This
// keeps the same counts runnable, with the definitions written down beside them:
//
//   workspace      a folder in the sessions tree, whose name encodes the cwd
//   session        one `.jsonl` transcript in it
//   tool call      a `toolCall` block in an assistant message
//   before edit    how many tool calls came first, per session that ran edit/write
//   bash as editor a bash command that reads a file instead of using `read`
//
// A transcript kept growing after the retro ran, so `--as-of` cuts every entry
// by its own timestamp and reproduces a past corpus from today's files.

const SESSIONS_ROOT = join(homedir(), '.pi', 'agent', 'sessions')
const EDIT_TOOLS = new Set(['edit', 'write'])
const BASH_AS_EDITOR = /\bcat\b|sed -n|Get-Content/

function fail(message) {
  console.error(message)
  process.exit(1)
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const match = flag('match')
if (match === undefined || match === '') {
  fail('Missing --match <substring>; it filters the workspace folders by name')
}

const asOf = flag('as-of')
if (asOf !== undefined && Number.isNaN(Date.parse(asOf))) {
  fail(`--as-of ${asOf} is not a date; use an ISO timestamp`)
}

function before(timestamp) {
  return asOf === undefined || timestamp === undefined || timestamp <= asOf
}

function transcripts() {
  const files = []
  for (const workspace of readdirSync(SESSIONS_ROOT)) {
    if (!workspace.toLowerCase().includes(match.toLowerCase())) continue
    const directory = join(SESSIONS_ROOT, workspace)
    if (!statSync(directory).isDirectory()) continue
    for (const name of readdirSync(directory)) {
      if (name.endsWith('.jsonl')) files.push(join(directory, name))
    }
  }
  return files
}

function entries(file) {
  const read = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      read.push(JSON.parse(line))
    } catch {
      // A transcript cut off mid-write keeps its earlier entries; the retro's
      // parsers skipped malformed lines the same way.
    }
  }
  return read
}

const stats = {
  sessions: 0,
  calls: 0,
  bash: 0,
  cdPrefixed: 0,
  bashAsEditor: 0,
  rulesAny: 0,
  rulesFull: 0,
  callsBeforeEdit: [],
}

for (const file of transcripts()) {
  const read = entries(file)
  const start = read.find((entry) => entry.type === 'session')?.timestamp
  if (!before(start)) continue

  stats.sessions += 1
  let index = 0
  let firstEdit = null

  for (const entry of read) {
    if (entry.type !== 'message' || entry.message?.role !== 'assistant') continue
    if (!before(entry.timestamp)) continue
    for (const block of entry.message.content ?? []) {
      if (block?.type !== 'toolCall') continue
      index += 1
      stats.calls += 1
      const args = block.arguments ?? {}

      if (EDIT_TOOLS.has(block.name) && firstEdit === null) firstEdit = index

      if (block.name === 'bash') {
        stats.bash += 1
        const command = String(args.command ?? '')
        if (/^\s*cd\s/.test(command)) stats.cdPrefixed += 1
        if (BASH_AS_EDITOR.test(command)) stats.bashAsEditor += 1
      }

      if (block.name === 'read') {
        const path = String(args.path ?? '')
        if (!path.toLowerCase().includes('rules.md')) continue
        stats.rulesAny += 1
        if (args.offset === undefined && args.limit === undefined) {
          stats.rulesFull += 1
        }
      }
    }
  }

  if (firstEdit !== null) stats.callsBeforeEdit.push(firstEdit)
}

function share(count, total) {
  return total === 0 ? '—' : `${((count / total) * 100).toFixed(1)}%`
}

function quantile(sorted, fraction) {
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * fraction) - 1
  )
  return sorted[index]
}

const sorted = [...stats.callsBeforeEdit].sort((a, b) => a - b)
const count = (value) => value.toLocaleString('en-US')
const rows = [
  ['workspace', match],
  ['as of', asOf ?? 'now (every entry written so far)'],
  ['sessions', count(stats.sessions)],
  ['tool calls', count(stats.calls)],
  ['bash', `${count(stats.bash)} (${share(stats.bash, stats.calls)} of calls)`],
  [
    'bash prefixed "cd …"',
    `${count(stats.cdPrefixed)} (${share(stats.cdPrefixed, stats.bash)} of bash)`,
  ],
  [
    'bash as editor',
    `${count(stats.bashAsEditor)} (cat, sed -n, Get-Content; ${share(
      stats.bashAsEditor,
      stats.bash
    )} of bash)`,
  ],
  [
    'calls before first edit',
    sorted.length === 0
      ? 'no edit ran'
      : `median ${quantile(sorted, 0.5)} · p75 ${quantile(
          sorted,
          0.75
        )} · p90 ${quantile(sorted, 0.9)} (n=${count(sorted.length)})`,
  ],
  [
    'RULES.md reads',
    `${count(stats.rulesAny)} (${count(stats.rulesFull)} full-file)`,
  ],
]

const width = Math.max(...rows.map(([label]) => label.length))
for (const [label, value] of rows) {
  console.log(`${label.padEnd(width)}  ${value}`)
}

// The root is named in the output so a report says which machine's history it
// measured.
console.log(`\nsource: ${relative(homedir(), SESSIONS_ROOT)}`)
