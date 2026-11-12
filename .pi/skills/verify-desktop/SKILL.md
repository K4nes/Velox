---
name: verify-desktop
description: Check the packaged Windows app against its acceptance criteria: installer name and version, a per-user install, the console loading from bundled assets, and theme plus active chain surviving a restart. Use after changing src-tauri/, the build wiring, or anything the bundle serves, and before a release cut.
---

# Verify the packaged app

Run this against the installed app, not the repo. A green build proves the code compiles. This proves the window a user opens works.

The mechanical part is `scripts/desktop-check.mjs`. The steps here are what has to happen around it.

Two facts that decide a verdict before anything runs.

- A build that leaves only `src-tauri/target/release/Velox.exe` is a failure. The installer is the deliverable.
- Inside the packaged app, a path the bundle does not hold returns `index.html` with a 200. So a fetch to `/api/*` gets HTML, not a 404. Sign-in and the USD price figure are expected to be broken here until T2 and T3 replace those calls with commands.

## 1. Build

```powershell
npm run build:desktop
```

Done when the command exits 0 and `src-tauri/target/release/bundle/nsis/` holds exactly one `Velox_<package.json version>_x64-setup.exe`.

## 2. Install without elevation

Confirm the shell is not elevated, then install silently.

```powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)  # must be False
Start-Process 'src-tauri\target\release\bundle\nsis\Velox_0.1.2_x64-setup.exe' -ArgumentList '/S' -Wait
```

Done when `%LOCALAPPDATA%\Velox\Velox.exe` exists, the folder holds only `Velox.exe` and `uninstall.exe`, the Start-menu shortcut exists, the `HKCU` uninstall key reports the package version, and no `HKLM` uninstall key exists.

A folder holding a `dist` tree means the assets were shipped loose instead of embedded. That is a regression.

## 3. Drive it

Move `dist` aside so the app cannot read it, launch from the shortcut with the debugging port open, then run the first phase.

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
Start-Process "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Velox.lnk"
Start-Sleep -Seconds 9
node scripts/desktop-check.mjs --phase drive
```

Done when all eight checks read `PASS`. It also toggles the theme and seeds the chain so the next step has something to survive.

## 4. Restart for real

Close the process by force, confirm the count is zero, and launch again from the shortcut. A cold process is a harsher test than a graceful close, because storage has to be on disk rather than in memory.

```powershell
Get-Process Velox -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
node scripts/desktop-check.mjs --phase restart
```

Done when all four checks read `PASS`, including the theme applying before any interaction and the wallet profile page showing the currency of the stored chain.

## 5. Leave the machine as you found it

```powershell
Start-Process "$env:LOCALAPPDATA\Velox\uninstall.exe" -ArgumentList '/S' -Wait
Remove-Item "$env:LOCALAPPDATA\com.k4nes.velox" -Recurse -Force -ErrorAction Ignore
```

Done when the install folder, the shortcut and the `HKCU` key are gone and `dist` is back where it was.

`com.k4nes.velox` is the webview profile, and it is the folder the uninstaller keeps unless "delete app data" is ticked. It holds the wallets, so removing it by hand is only safe on a machine used for checks.

## Report

One line per acceptance criterion, each carrying the value that was read, not a claim. The two phase summaries end it, for example `7/7 checks passed in phase "drive"` and `4/4 checks passed in phase "restart"`.
