import { createHash, createPublicKey, verify } from 'node:crypto'

// Ed25519 SubjectPublicKeyInfo header, so the raw 32 byte key from the minisign
// file can be handed to node's verifier without a key format library.
const SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex')
const COMMENT_PREFIX = 'trusted comment: '
const BASE64 = /^[A-Za-z0-9+/=]+$/

function readBox(signatureBox) {
  const box = String(signatureBox ?? '').trim()
  if (box === '') {
    throw new Error('the update signature is empty')
  }
  if (!BASE64.test(box)) {
    throw new Error('the update signature is not base64')
  }
  const lines = Buffer.from(box, 'base64').toString('utf8').split('\n')
  const comment = lines.find((line) => line.startsWith(COMMENT_PREFIX))
  if (!comment) {
    throw new Error('the update signature has no trusted comment')
  }
  return { box, lines, comment: comment.slice(COMMENT_PREFIX.length) }
}

function readFields(comment) {
  const fields = new Map()
  for (const field of comment.split('\t')) {
    const separator = field.indexOf(':')
    if (separator !== -1) {
      fields.set(field.slice(0, separator), field.slice(separator + 1))
    }
  }
  return fields
}

function readKey(pubkey) {
  const text = Buffer.from(String(pubkey ?? '').trim(), 'base64').toString('utf8').split('\n')
  if (!text[0]?.startsWith('untrusted comment: minisign public key:')) {
    throw new Error('plugins.updater.pubkey is not a minisign public key')
  }
  const raw = Buffer.from(text[1] ?? '', 'base64')
  if (raw.length !== 42) {
    throw new Error('plugins.updater.pubkey is malformed')
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_HEADER, raw.subarray(10, 42)]),
    format: 'der',
    type: 'spki',
  })
}

// Verifies the artifact bytes against the signature, then the trusted comment
// against the global signature, and returns what the comment claims. A stale
// signature or a rebuilt artifact fails here, which is the gate the plugin runs
// again at install time.
export function verifyMinisign({ content, signatureBox, pubkey }) {
  const { box, lines, comment } = readBox(signatureBox)
  const fields = readFields(comment)
  const version = fields.get('version')
  if (!version) {
    throw new Error('the update signature has no version field')
  }

  const signature = Buffer.from(lines[1] ?? '', 'base64')
  const globalSignature = Buffer.from(lines[3] ?? '', 'base64')
  if (signature.length !== 74 || globalSignature.length !== 64) {
    throw new Error('the update signature is malformed')
  }

  const key = readKey(pubkey)
  const body = signature.subarray(10, 74)
  const digest = createHash('blake2b512').update(content).digest()
  if (!verify(null, digest, key, body)) {
    throw new Error('the update signature does not match the installer')
  }
  if (!verify(null, Buffer.concat([body, Buffer.from(comment)]), key, globalSignature)) {
    throw new Error('the update signature trusted comment does not match')
  }

  return { version, file: fields.get('file'), box }
}
