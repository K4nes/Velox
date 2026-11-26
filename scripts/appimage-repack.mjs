// Argument builders for the Linux release repack. Tauri's stock bundle writes
// zstd with 128 KiB blocks, which leaves the AppImage at 116.6 MB locally;
// release-linux.mjs repacks the built AppDir through the appimagetool Tauri
// already caches, at 1 MiB blocks and level 22, then signs the new file.
//
// `npm run test:release` loads this file with Node directly, so it imports
// nothing at runtime and names no `@/` alias.

const BLOCK_SIZE = 1048576
const COMPRESSION_LEVEL = 22

export function appimagetoolArgs({ appDir, artifact }) {
  return [
    '--no-appstream',
    '--mksquashfs-opt=-b',
    `--mksquashfs-opt=${BLOCK_SIZE}`,
    '--mksquashfs-opt=-Xcompression-level',
    `--mksquashfs-opt=${COMPRESSION_LEVEL}`,
    appDir,
    artifact,
  ]
}

export function signArgs({ artifact, version }) {
  return ['signer', 'sign', '--app-version', version, artifact]
}
