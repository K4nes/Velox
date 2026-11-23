// The manifest shape is assembled and checked here so the release runners in
// release-desktop.mjs and release-linux.mjs only read files and print paths.

const DOWNLOAD_PATH = '/releases/latest/download/'
const GITHUB_ROOT = 'https://github.com/'
const DEFAULT_PLATFORM = 'windows-x86_64'

function stripTrailingSlashes(url) {
  return url.replace(/\/+$/, '')
}

function repositoryFor(endpoint) {
  const trimmed = stripTrailingSlashes(endpoint)
  const marker = trimmed.indexOf(DOWNLOAD_PATH)
  if (marker === -1) {
    throw new Error(`update endpoint ${endpoint} is not a GitHub latest/download URL`)
  }

  const repo = trimmed.slice(0, marker)
  const manifest = trimmed.slice(marker + DOWNLOAD_PATH.length)
  if (manifest === '' || manifest.includes('/') || !manifest.endsWith('.json')) {
    throw new Error(`update endpoint ${endpoint} does not name a JSON manifest`)
  }

  const parts = repo.startsWith(GITHUB_ROOT)
    ? repo.slice(GITHUB_ROOT.length).split('/')
    : []
  if (parts.length !== 2 || parts.some((part) => part === '')) {
    throw new Error(`update endpoint ${endpoint} is not ${GITHUB_ROOT}OWNER/REPO${DOWNLOAD_PATH}<manifest>.json`)
  }

  return repo
}

export function assetUrl({ endpoint, version, fileName }) {
  return `${repositoryFor(endpoint)}/releases/download/v${version}/${fileName}`
}

export function releaseNotes(changelogText, version) {
  const lines = changelogText.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
  if (start === -1) {
    throw new Error(`no CHANGELOG section for ${version}`)
  }

  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    body.push(line.trim())
  }
  while (body.length > 0 && body[0] === '') body.shift()
  while (body.length > 0 && body[body.length - 1] === '') body.pop()
  return body.join('\n')
}

export function buildManifest({
  version,
  notes,
  fileName,
  signature,
  pubDate,
  endpoint,
  platform = DEFAULT_PLATFORM,
}) {
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [platform]: {
        signature,
        url: assetUrl({ endpoint, version, fileName }),
      },
    },
  }
}

export function verifyRelease({
  manifest,
  signed,
  artifactName,
  artifactVersion,
  endpoint,
  platform = DEFAULT_PLATFORM,
}) {
  if (manifest.version !== artifactVersion) {
    throw new Error(
      `manifest version ${manifest.version} disagrees with the artifact version ${artifactVersion}`,
    )
  }

  if (signed.version !== manifest.version) {
    throw new Error(
      `manifest version ${manifest.version} disagrees with the signed version ${signed.version}`,
    )
  }
  if (signed.file !== artifactName) {
    throw new Error(`the signature names ${signed.file ?? 'no file'} but the artifact is ${artifactName}`)
  }

  const platforms = Object.keys(manifest.platforms ?? {})
  if (platforms.length !== 1 || platforms[0] !== platform) {
    throw new Error(
      `manifest platforms must be exactly ${platform}, found ${platforms.join(', ') || 'none'}`,
    )
  }

  const selected = manifest.platforms[platform]
  if (selected.signature !== signed.box) {
    throw new Error('the manifest signature is not the signature beside the artifact')
  }

  const expectedUrl = assetUrl({ endpoint, version: artifactVersion, fileName: artifactName })
  if (selected.url !== expectedUrl) {
    throw new Error(`the manifest url ${selected.url} is not the release asset ${expectedUrl}`)
  }
}
