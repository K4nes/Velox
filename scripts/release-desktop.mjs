import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildManifest, releaseNotes, verifyRelease } from './latest-json.mjs'

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
  const artifactName = `Velox_${version}_x64-setup.exe`
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
  // A plain `npm run build:desktop` overwrites the installer and leaves the old .sig
  // behind, so the signature would no longer describe the bytes on disk.
  if (statSync(installer).mtimeMs > statSync(signaturePath).mtimeMs) {
    fail(
      `${artifactName} was written after its signature; run npm run release:desktop to sign the current build`,
    )
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

// The plugin checks the signature at install time; this catches a build signed by a
// different key pair before the artifact is uploaded.
function checkSigningKey(pubkey, signature) {
  const publicText = Buffer.from(pubkey, 'base64').toString('utf8').split('\n')
  if (!publicText[0].startsWith('untrusted comment: minisign public key:')) {
    fail('plugins.updater.pubkey is not a minisign public key')
  }

  const publicKey = Buffer.from(publicText[1] ?? '', 'base64')
  const signatureText = Buffer.from(signature, 'base64').toString('utf8').split('\n')
  const signatureBytes = Buffer.from(signatureText[1] ?? '', 'base64')
  if (publicKey.length < 10 || signatureBytes.length < 10) {
    fail('plugins.updater.pubkey or the update signature is malformed')
  }

  const publicKeyId = publicKey.subarray(2, 10).toString('hex')
  const signatureKeyId = signatureBytes.subarray(2, 10).toString('hex')
  if (publicKeyId !== signatureKeyId) {
    fail(
      `the installer was signed by key ${signatureKeyId} but plugins.updater.pubkey is ${publicKeyId}`,
    )
  }
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
  const version = readVersion()
  const notes = releaseNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version)
  const { pubkey, endpoint, binary } = readConfig()

  if (!verifyOnly) {
    build(version)
    const appVersion = readProductVersion(join(ROOT, 'src-tauri', 'target', 'release', `${binary}.exe`))
    if (appVersion !== version) {
      fail(`${binary}.exe reports ${appVersion} but package.json is ${version}`)
    }
  }

  const artifacts = locateInstaller(version)
  checkSigningKey(pubkey, artifacts.signature)
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
      signature: artifacts.signature,
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

try {
  main()
} catch (error) {
  fail(describe(error))
}
