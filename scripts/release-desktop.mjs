import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildManifest, releaseNotes, verifyRelease } from './latest-json.mjs'
import { verifyMinisign } from './minisign.mjs'
import { draftReleaseCommand, installerName } from './release-command.mjs'

const ROOT = join(import.meta.dirname, '..')
const BUNDLE_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const TAURI_CLI = join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const RELEASE_OVERLAY = join(ROOT, 'src-tauri', 'tauri.release.conf.json')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${describe(error)}`)
  }
}

function readVersion() {
  return readJson(join(ROOT, 'package.json'), 'package.json').version
}

function readConfig() {
  const config = readJson(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'src-tauri/tauri.conf.json')
  const updater = config.plugins?.updater
  if (!updater?.pubkey || !updater?.endpoints?.[0]) {
    fail('src-tauri/tauri.conf.json has no plugins.updater.pubkey or endpoints')
  }
  return { pubkey: updater.pubkey, endpoint: updater.endpoints[0], binary: config.mainBinaryName }
}

function build(version) {
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY
  if (!privateKey) {
    fail(
      'TAURI_SIGNING_PRIVATE_KEY is not set; put the release key at %USERPROFILE%\\.velox\\velox-updater.key and export that path (README.md, Desktop app and updates).',
    )
  }

  const args = [TAURI_CLI, 'build', '--config', RELEASE_OVERLAY]
  if (process.env.VELOX_WIN_CERT_THUMBPRINT) {
    args.push(
      '--config',
      JSON.stringify({
        bundle: {
          windows: {
            certificateThumbprint: process.env.VELOX_WIN_CERT_THUMBPRINT,
            digestAlgorithm: 'sha256',
            timestampUrl:
              process.env.VELOX_WIN_TIMESTAMP_URL ?? 'http://timestamp.digicert.com',
          },
        },
      }),
    )
  }

  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    fail(`tauri build failed while building Velox ${version}`)
  }
}

function locateInstaller(version) {
  const artifactName = installerName(version)
  const installer = join(BUNDLE_DIR, artifactName)
  if (!existsSync(installer)) {
    fail(`no ${artifactName} in ${BUNDLE_DIR}; build it before writing the manifest`)
  }

  const signaturePath = `${installer}.sig`
  if (!existsSync(signaturePath)) {
    fail(`${signaturePath} is missing`)
  }
  const signature = readFileSync(signaturePath, 'utf8').trim()
  if (signature === '') {
    fail(`${signaturePath} is empty`)
  }

  return { installer, signaturePath, artifactName, signature }
}

function readProductVersion(installer) {
  const literal = installer.replace(/'/g, "''")
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `(Get-Item -LiteralPath '${literal}').VersionInfo.ProductVersion`,
    ],
    { encoding: 'utf8' },
  )
  return output.trim()
}

function readManifest() {
  const path = join(BUNDLE_DIR, 'latest.json')
  if (!existsSync(path)) {
    fail(`${path} is missing`)
  }
  return readJson(path, `${path}`)
}

function main() {
  const verifyOnly = process.argv.includes('--verify-only')
  const draft = process.argv.includes('--draft')
  const version = readVersion()
  const notes = releaseNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version)
  const { pubkey, endpoint, binary } = readConfig()
  const command = draftReleaseCommand({ version, bundleDir: BUNDLE_DIR, notes })

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(command))
    return
  }

  if (!verifyOnly) {
    build(version)
    const appVersion = readProductVersion(join(ROOT, 'src-tauri', 'target', 'release', `${binary}.exe`))
    if (appVersion !== version) {
      fail(`${binary}.exe reports ${appVersion} but package.json is ${version}`)
    }
  }

  const artifacts = locateInstaller(version)
  let signed
  try {
    signed = verifyMinisign({
      content: readFileSync(artifacts.installer),
      signatureBox: artifacts.signature,
      pubkey,
    })
  } catch (error) {
    fail(describe(error))
  }
  const artifactVersion = readProductVersion(artifacts.installer)
  const manifest = verifyOnly
    ? readManifest()
    : buildManifest({
        version,
        notes,
        fileName: artifacts.artifactName,
        signature: artifacts.signature,
        pubDate: new Date().toISOString(),
        endpoint,
      })

  try {
    verifyRelease({
      manifest,
      signed,
      artifactName: artifacts.artifactName,
      artifactVersion,
      endpoint,
    })
  } catch (error) {
    fail(describe(error))
  }

  const manifestPath = join(BUNDLE_DIR, 'latest.json')
  if (!verifyOnly) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  if (draft) {
    publishDraft({
      command,
      signed,
      artifactName: artifacts.artifactName,
      artifactVersion,
      endpoint,
      version,
    })
    return
  }

  console.log('')
  console.log('Upload these files:')
  console.log(artifacts.installer)
  console.log(artifacts.signaturePath)
  console.log(manifestPath)
  console.log(`git tag -a v${version} -m "v${version}"`)
  console.log(`git push origin v${version}`)
  console.log(
    `gh release create v${version} --verify-tag --draft "${artifacts.installer}" "${artifacts.signaturePath}" "${manifestPath}"`,
  )
}

function publishDraft({ command, signed, artifactName, artifactVersion, endpoint, version }) {
  // These are the bytes gh uploads, so check the file on disk rather than the
  // object still in memory.
  try {
    verifyRelease({ manifest: readManifest(), signed, artifactName, artifactVersion, endpoint })
  } catch (error) {
    fail(describe(error))
  }

  const result = spawnSync('gh', command, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    const reason = result.error ? describe(result.error) : 'non-zero exit'
    fail(`gh release create failed for v${version}: ${reason}`)
  }

  console.log('')
  console.log(`Draft release v${version} holds the installer, its signature and the manifest.`)
}

try {
  main()
} catch (error) {
  fail(describe(error))
}
