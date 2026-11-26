import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { appimagetoolArgs, signArgs } from './appimage-repack.mjs'
import { buildManifest, releaseNotes, verifyRelease } from './latest-json.mjs'
import { verifyMinisign } from './minisign.mjs'

const ROOT = join(import.meta.dirname, '..')
const BUNDLE_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'appimage')
const APP_DIR = join(BUNDLE_DIR, 'Velox.AppDir')
const APPIMAGETOOL_APPIMAGE = join(
  ROOT,
  'src-tauri',
  'target',
  '.tauri',
  'linuxdeploy-plugin-appimage.AppImage',
)
const TAURI_CLI = join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const RELEASE_OVERLAY = join(ROOT, 'src-tauri', 'tauri.release.conf.json')
const BASE_CONFIG = join(ROOT, 'src-tauri', 'tauri.conf.json')
const LINUX_CONFIG = join(ROOT, 'src-tauri', 'tauri.linux.conf.json')
const PLATFORM = 'linux-x86_64'
const MANIFEST = 'latest-linux.json'
// The bundle names the entry after the GTK app id, so this exact file is what
// tauri.linux.conf.json copies into the AppDir and what carries the version.
const DESKTOP_ENTRY = 'com.k4nes.velox.desktop'

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

function artifactName(version) {
  return `Velox_${version}_amd64.AppImage`
}

function readConfig() {
  const base = readJson(BASE_CONFIG, 'src-tauri/tauri.conf.json')
  const linux = readJson(LINUX_CONFIG, 'src-tauri/tauri.linux.conf.json')
  const updater = {
    ...(base.plugins?.updater ?? {}),
    ...(linux.plugins?.updater ?? {}),
  }
  if (!updater.pubkey || !updater.endpoints?.[0]) {
    fail('the merged Tauri config has no plugins.updater.pubkey or endpoints')
  }
  return {
    pubkey: updater.pubkey,
    endpoint: updater.endpoints[0],
  }
}

// The AppImage's portability is set by the build host's glibc and the bundled
// WebKitGTK. Ubuntu 22.04 is the oldest practical Tauri v2 baseline.
function assertBaseline() {
  if (process.env.VELOX_ALLOW_NON_BASELINE === '1') return

  let release = ''
  try {
    release = readFileSync('/etc/os-release', 'utf8')
  } catch {
    // A host without os-release cannot prove the baseline; refuse it.
  }
  const id = release.match(/^ID="?([^"\n]+)"?/m)?.[1]
  const version = release.match(/^VERSION_ID="?([^"\n]+)"?/m)?.[1]
  const baseline =
    (id === 'ubuntu' && version === '22.04') ||
    (id === 'debian' && version === '12')
  if (!baseline) {
    fail(
      'release-linux must build on Ubuntu 22.04 or Debian 12 so the AppImage ' +
        'runs on older glibc hosts. Use npm run build:desktop for a local ' +
        'CachyOS build, or set VELOX_ALLOW_NON_BASELINE=1 to test this script.',
    )
  }
}

function build() {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    fail(
      'TAURI_SIGNING_PRIVATE_KEY is not set; the Linux updater artifact ' +
        'cannot be signed without it.',
    )
  }

  const result = spawnSync(
    process.execPath,
    [TAURI_CLI, 'build', '--config', RELEASE_OVERLAY],
    { cwd: ROOT, stdio: 'inherit', env: process.env },
  )
  if (result.status !== 0) {
    fail('tauri build failed while building the Linux AppImage')
  }
}

// Tauri writes zstd with 128 KiB blocks, which leaves the stock AppImage at
// 116.6 MB locally. Repack the same AppDir at 1 MiB blocks and level 22 with
// the appimagetool Tauri already cached; the desktop entry and its
// X-AppImage-Version live in the AppDir, so readAppImageVersion still holds.
// The repack invalidates the bundle's signature, so sign the new bytes after.
function repack(version) {
  const artifact = join(BUNDLE_DIR, artifactName(version))
  if (!existsSync(APPIMAGETOOL_APPIMAGE)) {
    fail(
      `no cached ${APPIMAGETOOL_APPIMAGE}; a Tauri Linux build places it ` +
        `there, so run npm run build:desktop first.`,
    )
  }
  if (!existsSync(APP_DIR)) {
    fail(`no AppDir at ${APP_DIR}; the bundle did not produce one`)
  }
  if (!existsSync(artifact)) {
    fail(`no ${artifactName(version)} in ${BUNDLE_DIR}; the bundle did not produce it`)
  }

  const tools = mkdtempSync(join(tmpdir(), 'velox-appimagetool-'))
  try {
    const extracted = spawnSync(APPIMAGETOOL_APPIMAGE, ['--appimage-extract'], {
      cwd: tools,
      encoding: 'utf8',
    })
    if (extracted.error) {
      fail(`could not run ${APPIMAGETOOL_APPIMAGE}: ${describe(extracted.error)}`)
    }
    if (extracted.status !== 0) {
      fail(
        `could not extract ${APPIMAGETOOL_APPIMAGE}: ` +
          (extracted.stderr.trim() || `exit ${extracted.status}`),
      )
    }

    const appimagetool = join(
      tools,
      'squashfs-root',
      'appimagetool-prefix',
      'usr',
      'bin',
      'appimagetool',
    )
    if (!existsSync(appimagetool)) {
      fail(`${APPIMAGETOOL_APPIMAGE} does not carry ${appimagetool}`)
    }

    // appimagetool shells out to mksquashfs and desktop-file-validate by name;
    // the prefix carries both, so neither this host nor the CI runner needs
    // squashfs-tools installed.
    const binDir = dirname(appimagetool)
    const repacked = spawnSync(appimagetool, appimagetoolArgs({ appDir: APP_DIR, artifact }), {
      cwd: tools,
      stdio: 'inherit',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    })
    if (repacked.status !== 0) {
      fail('appimagetool failed to repack the Linux AppImage')
    }
  } finally {
    rmSync(tools, { recursive: true, force: true })
  }

  const signed = spawnSync(
    process.execPath,
    [TAURI_CLI, ...signArgs({ artifact, version })],
    { cwd: ROOT, stdio: 'inherit' },
  )
  if (signed.status !== 0) {
    fail(`could not re-sign ${artifactName(version)} after the repack`)
  }

  console.log(`${artifactName(version)} is ${statSync(artifact).size} bytes after the repack`)
}

function locateArtifact(version) {
  const name = artifactName(version)
  const artifact = join(BUNDLE_DIR, name)
  if (!existsSync(artifact)) {
    fail(`no ${name} in ${BUNDLE_DIR}; build it before writing the manifest`)
  }

  const signaturePath = `${artifact}.sig`
  if (!existsSync(signaturePath)) {
    fail(`${signaturePath} is missing`)
  }
  const signature = readFileSync(signaturePath, 'utf8').trim()
  if (signature === '') {
    fail(`${signaturePath} is empty`)
  }

  return { artifact, signaturePath, name, signature }
}

// Read the version the AppImage advertises, not the one we intended to write.
// The updater compares the manifest against the running app's version.
function readAppImageVersion(artifact) {
  const temp = mkdtempSync(join(tmpdir(), 'velox-appimage-'))
  try {
    const result = spawnSync(
      artifact,
      ['--appimage-extract', `usr/share/applications/${DESKTOP_ENTRY}`],
      { cwd: temp, encoding: 'utf8' },
    )
    if (result.error) {
      fail(`could not run ${artifact}: ${describe(result.error)}`)
    }
    if (result.status !== 0) {
      fail(
        `could not extract the desktop entry from ${artifact}: ` +
          (result.stderr.trim() || `exit ${result.status}`),
      )
    }

    const desktop = readFileSync(
      join(temp, 'squashfs-root', 'usr', 'share', 'applications', DESKTOP_ENTRY),
      'utf8',
    )
    const version = desktop.match(/^X-AppImage-Version=(.+)$/m)?.[1]?.trim()
    if (!version) {
      fail(`${artifact} has no X-AppImage-Version in its desktop entry`)
    }
    return version
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function main() {
  const version = readVersion()
  const { pubkey, endpoint } = readConfig()

  if (process.argv.includes('--dry-run')) {
    console.log(
      JSON.stringify(
        {
          version,
          platform: PLATFORM,
          endpoint,
          artifact: join(BUNDLE_DIR, artifactName(version)),
          manifest: join(BUNDLE_DIR, MANIFEST),
        },
        null,
        2,
      ),
    )
    return
  }

  assertBaseline()
  const notes = releaseNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version)

  build()
  repack(version)
  const artifacts = locateArtifact(version)
  const artifactVersion = readAppImageVersion(artifacts.artifact)
  if (artifactVersion !== version) {
    fail(`${artifacts.name} reports ${artifactVersion} but package.json is ${version}`)
  }

  let signed
  try {
    signed = verifyMinisign({
      content: readFileSync(artifacts.artifact),
      signatureBox: artifacts.signature,
      pubkey,
    })
  } catch (error) {
    fail(describe(error))
  }

  const manifest = buildManifest({
    version,
    notes,
    fileName: artifacts.name,
    signature: artifacts.signature,
    pubDate: new Date().toISOString(),
    endpoint,
    platform: PLATFORM,
  })

  try {
    verifyRelease({
      manifest,
      signed,
      artifactName: artifacts.name,
      artifactVersion,
      endpoint,
      platform: PLATFORM,
    })
  } catch (error) {
    fail(describe(error))
  }

  const manifestPath = join(BUNDLE_DIR, MANIFEST)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  console.log('')
  console.log('Upload these files:')
  console.log(artifacts.artifact)
  console.log(artifacts.signaturePath)
  console.log(manifestPath)
  console.log(
    `gh release upload v${version} "${artifacts.artifact}" ` +
      `"${artifacts.signaturePath}" "${manifestPath}" --clobber`,
  )
}

try {
  main()
} catch (error) {
  fail(describe(error))
}
