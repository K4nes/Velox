// The manifest shape is assembled and checked here so the runner in
// release-desktop.mjs only reads files and prints paths.

const LATEST_SUFFIX = '/releases/latest/download/latest.json'
const GITHUB_ROOT = 'https://github.com/'
const PLATFORM = 'windows-x86_64'

function stripTrailingSlashes(url) {
  return url.replace(/\/+$/, '')
}

export function assetUrl({ endpoint, version, fileName }) {
  const trimmed = stripTrailingSlashes(endpoint)
  if (!trimmed.endsWith(LATEST_SUFFIX)) {
    throw new Error(`update endpoint ${endpoint} does not end with ${LATEST_SUFFIX}`)
  }

  const repo = trimmed.slice(0, -LATEST_SUFFIX.length)
  const parts = repo.startsWith(GITHUB_ROOT) ? repo.slice(GITHUB_ROOT.length).split('/') : []
  if (parts.length !== 2 || parts.some((part) => part === '')) {
    throw new Error(`update endpoint ${endpoint} is not ${GITHUB_ROOT}OWNER/REPO${LATEST_SUFFIX}`)
  }

  return `${repo}/releases/download/v${version}/${fileName}`
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

export function buildManifest({ version, notes, fileName, signature, pubDate, endpoint }) {
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [PLATFORM]: {
        signature,
        url: assetUrl({ endpoint, version, fileName }),
      },
    },
  }
}

export function verifyRelease({ manifest, signed, artifactName, artifactVersion, endpoint }) {
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
  if (platforms.length !== 1 || platforms[0] !== PLATFORM) {
    throw new Error(
      `manifest platforms must be exactly ${PLATFORM}, found ${platforms.join(', ') || 'none'}`,
    )
  }

  const platform = manifest.platforms[PLATFORM]
  if (platform.signature !== signed.box) {
    throw new Error('the manifest signature is not the signature beside the artifact')
  }

  const expectedUrl = assetUrl({ endpoint, version: artifactVersion, fileName: artifactName })
  if (platform.url !== expectedUrl) {
    throw new Error(`the manifest url ${platform.url} is not the release asset ${expectedUrl}`)
  }
}
