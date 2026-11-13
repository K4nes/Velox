import { isTauri } from '@tauri-apps/api/core'

// In the packaged app `navigator.clipboard.readText` raises a native permission
// prompt on every call, so the plugin reads and writes the OS clipboard from Rust.
export async function readClipboardText(): Promise<string> {
  if (isTauri()) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    const text: string | null = await readText()
    return text ?? ''
  }
  return navigator.clipboard.readText()
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    return writeText(text)
  }
  return navigator.clipboard.writeText(text)
}
