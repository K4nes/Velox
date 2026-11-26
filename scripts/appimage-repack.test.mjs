import assert from 'node:assert/strict'
import test from 'node:test'
import { appimagetoolArgs, signArgs } from './appimage-repack.mjs'

test('the repack asks appimagetool for zstd with 1 MiB blocks at level 22', () => {
  assert.deepEqual(
    appimagetoolArgs({
      appDir: '/bundle/Velox.AppDir',
      artifact: '/bundle/Velox_0.3.0_amd64.AppImage',
    }),
    [
      '--no-appstream',
      '--mksquashfs-opt=-b',
      '--mksquashfs-opt=1048576',
      '--mksquashfs-opt=-Xcompression-level',
      '--mksquashfs-opt=22',
      '/bundle/Velox.AppDir',
      '/bundle/Velox_0.3.0_amd64.AppImage',
    ],
  )
})

test('the re-sign binds the signature to the artifact version', () => {
  assert.deepEqual(signArgs({ artifact: '/bundle/Velox_0.3.0_amd64.AppImage', version: '0.3.0' }), [
    'signer',
    'sign',
    '--app-version',
    '0.3.0',
    '/bundle/Velox_0.3.0_amd64.AppImage',
  ])
})
