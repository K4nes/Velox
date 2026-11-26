import type { MouseEvent } from 'react'
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

// A plain left click goes through the helper; middle-click and modified clicks
// keep the anchor's own behaviour.
export function onExternalLinkClick(url: string) {
  return (event: MouseEvent<HTMLAnchorElement>): void => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    openExternal(url)
  }
}
