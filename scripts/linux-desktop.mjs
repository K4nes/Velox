// Writes the Linux desktop entry and AppStream metadata for the AppImage.
// `tauri.linux.conf.json` runs this before bundling and copies both files into
// the AppDir, so the version in `package.json` is the one the AppImage advertises.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'src-tauri', 'target', 'linux')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const date = new Date().toISOString().slice(0, 10)

const desktop = `[Desktop Entry]
Categories=Office;Finance;
Comment=NFT Desktop App Console
Exec=Velox
GenericName=NFT Operator Console
Icon=Velox
Keywords=NFT;wallet;portfolio;mint;EVM;
Name=Velox
StartupNotify=true
StartupWMClass=Velox
Terminal=false
Type=Application
Version=1.5
X-AppImage-Name=Velox
X-AppImage-Version=${version}
`

const metainfo = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>com.k4nes.velox</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>
  <name>Velox</name>
  <summary>NFT Desktop App Console</summary>
  <description>
    <p>Velox is an operator console for NFT work across stored EVM wallets: mint, PnL, portfolio, bulk sell, instant sell, transfer and swap.</p>
  </description>
  <launchable type="desktop-id">Velox.desktop</launchable>
  <provides>
    <binary>Velox</binary>
  </provides>
  <categories>
    <category>Office</category>
    <category>Finance</category>
  </categories>
  <url type="homepage">https://github.com/K4nes/Velox</url>
  <developer id="com.k4nes">
    <name>K4nes</name>
  </developer>
  <content_rating type="oars-1.1"/>
  <releases>
    <release version="${version}" date="${date}"/>
  </releases>
</component>
`

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'Velox.desktop'), desktop)
writeFileSync(join(OUT, 'com.k4nes.velox.metainfo.xml'), metainfo)
console.log(`wrote Linux desktop metadata for Velox ${version}`)
