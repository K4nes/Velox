# Releases

The project follows SemVer. Versions live in `package.json` and `CHANGELOG.md`, and every
release is tagged `vMAJOR.MINOR.PATCH` — a `v` prefix, no suffixes, no dates.

- `0.y.z` while the app is still settling; `1.0.0` once a user can rely on the data
  format and the page behaviour without reading the diff.
- `MAJOR` — a change that breaks a user: an IndexedDB migration that drops data, a
  renamed or removed page, a stored record whose meaning changes.
- `MINOR` — a new page, a new provider, a new capability.
- `PATCH` — fixes and refactors with no user-visible behaviour change.
- `DB_VERSION` in `src/lib/db/db.ts` is not the app version. It moves independently, with
  its own migration.

Cut a release by moving the `## [Unreleased]` entries into a new
`## [x.y.z] - YYYY-MM-DD` section, bumping `package.json` and `package-lock.json`, then
tagging the merged commit on `main`:

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

Annotated tags, never lightweight. A pushed tag is never moved or deleted: fix forward
with the next patch version.

### Desktop releases

Windows and Linux share the updater key and `src-tauri/tauri.release.conf.json`, which
turns on `bundle.createUpdaterArtifacts`. Only `npm run release:desktop` and
`npm run release:linux` pass that overlay, so `npm run build:desktop` keeps producing an
unsigned bundle with no `.sig`.

**Windows.** The NSIS installer carries two independent signing chains:

- Authenticode is optional. Without a certificate the SmartScreen warning is expected.
- The updater key is mandatory. `requireSignedVersion` refuses an unsigned version.

`npm run release:desktop` writes the installer, its `.sig` and `latest.json` into
`src-tauri/target/release/bundle/nsis/`; `npm run release:verify` re-checks those files
without rebuilding. This path is Windows-only.

**Linux.** `npm run build:desktop` produces
`src-tauri/target/release/bundle/appimage/Velox_<version>_amd64.AppImage` on a Linux host.
The AppImage is portable only when it is built on the oldest supported baseline, because
glibc cannot be bundled and the AppImage carries the host's WebKitGTK/GTK libraries.
`npm run release:linux` therefore refuses any host other than Ubuntu 22.04 or Debian 12
(glibc 2.35/2.36). `VELOX_ALLOW_NON_BASELINE=1` bypasses that guard only for a deliberate
local test; a CachyOS build iterates locally but is not a release artifact.

The Linux release runs on `ubuntu-22.04`. It builds and signs the AppImage, reads
`X-AppImage-Version` from the artifact, verifies the minisign signature and the manifest,
and writes `latest-linux.json` beside it. The Linux updater endpoint in
`tauri.linux.conf.json` points at that manifest; the manifest's platform key is
`linux-x86_64`. The Windows and Linux manifests stay separate, so `latest.json` remains a
one-platform Windows manifest and neither release job has to merge the other's file.

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`. The Windows job opens the
draft; the Linux job `needs` it, uploads the AppImage, its `.sig` and `latest-linux.json`
to the same draft, and never publishes. It never runs on a pull request: a Linux build is
proven at tag time, not on every change. The tag must equal `v` plus the package version;
the Windows job also fails rather than ship unsigned when the updater key is missing, when
`WINDOWS_CERTIFICATE` arrives without its password, and, once
`VELOX_REQUIRE_AUTHENTICODE` is `true`, when the certificate is absent. Linux has no
Authenticode chain; the updater key is the only signature it needs.

The updater reads its own keys from `tauri-plugin-updater`'s `config.rs`: `pubkey`,
`endpoints`, `requireSignedVersion`, `windows.installMode`. `@tauri-apps/cli`'s
`config.schema.json` describes only `bundle.createUpdaterArtifacts`, so a key absent from
the schema is not a key the plugin ignores.

The updater private key lives outside the repository at
`%USERPROFILE%\.velox\velox-updater.key`, with a backup in a second offline location. The
release workflows read it from the `TAURI_SIGNING_PRIVATE_KEY` secret; only the public key
is committed, as `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Never copy the
private key into the repository.

## Parallel slices

When several domain PRs land separately, only the integration or release PR edits
`CHANGELOG.md`; a domain slice leaves the `## [Unreleased]` block alone. A squash merge
then cannot conflict on the same `### Fixed` heading or the same entry line.
