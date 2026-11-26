import { isTauri } from '@tauri-apps/api/core'
import { toast } from 'sonner'

// A new-window anchor is denied by the webview, so the installed app hands the
// URL to the OS through the opener plugin. The browser lane keeps its own tab.
export function openExternal(url: string): void {
  if (isTauri()) {
    void import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(url))
      .catch(() => toast.error('Could not open the link'))
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
