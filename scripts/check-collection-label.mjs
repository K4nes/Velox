import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// The five read-only pages share one collection field, and its copy lived in five
// files. A label change was a five-file edit plus eight test files, and `RULES.md`
// still taught the old label after the pages had moved.
//
// The copy now lives in one module. A second copy in a page is the drift this
// catches. The two Mint cards are exempt: both providers work there, so their label
// names Scatter on purpose.
const SOURCE_DIR = 'src'
const SOURCE_FILE = /\.(ts|tsx)$/
const OWNER = path.join('src', 'components', 'collection-field.ts')
const MINT_DIR = path.join('src', 'pages', 'mint') + path.sep

// Strings that legitimately contain the label. The mint label names Scatter on
// purpose; the failure message is a sentence the label happens to start.
const KEEP = [
  'Collection URL or slug (OpenSea / Scatter)',
  'Collection URL not recognised',
]
const READ_LABEL = 'Collection URL'
const SCATTER_ART = 'scatter.art'

const offenders = []

for (const file of walk(SOURCE_DIR)) {
  if (file === OWNER) continue
  // `src/lib/collection-source.ts` matches the host, so the word is its work.
  const isPage = file.startsWith(path.join('src', 'pages') + path.sep)
  const isMintPage = file.startsWith(MINT_DIR)

  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const at = `${file}:${index + 1}: ${line.trim()}`
      const rest = KEEP.reduce((text, keep) => text.replaceAll(keep, ''), line)
      if (rest.includes(READ_LABEL) && !isMintPage) {
        offenders.push(`${at}\n  use COLLECTION_FIELD_LABEL from ${OWNER}`)
      }
      if (isPage && !isMintPage && line.includes(SCATTER_ART)) {
        offenders.push(`${at}\n  the read pages do not offer a Scatter URL`)
      }
    })
}

if (offenders.length === 0) {
  console.log(`${SOURCE_DIR}/ keeps the collection field copy in ${OWNER}`)
  process.exit(0)
}

for (const offender of offenders) console.error(offender)
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
