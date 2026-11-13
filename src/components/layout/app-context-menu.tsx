import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  readClipboardText,
  writeClipboardText,
} from '@/lib/clipboard/clipboard'
import {
  captureMenuTarget,
  insertClipboardText,
} from '@/lib/clipboard/text-target'
import type { MenuTarget } from '@/lib/clipboard/text-target'

const EMPTY_TARGET: MenuTarget = {
  field: null,
  range: null,
  copyText: '',
  canPaste: false,
}

/**
 * One menu for the whole window. Dialogs, sheets and popovers render into
 * `document.body`, outside the trigger subtree, so those right-clicks are
 * forwarded to the trigger at the same pointer coordinates.
 */
export function AppContextMenu({ children }: { children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  // The ref is what the item handlers read, so a click can never act on a target
  // captured by an older render; the state only re-renders the disabled flags.
  const targetRef = useRef<MenuTarget>(EMPTY_TARGET)
  const [target, setTarget] = useState<MenuTarget>(EMPTY_TARGET)

  function remember(node: EventTarget | null) {
    targetRef.current = captureMenuTarget(node)
    setTarget(targetRef.current)
  }

  useEffect(() => {
    function forward(event: MouseEvent) {
      const trigger = triggerRef.current
      if (!trigger) return
      if (event.target instanceof Node && trigger.contains(event.target)) return

      const element = event.target instanceof Element ? event.target : null
      // Inside an open menu the menu is already the surface; forwarding would
      // only move it under the pointer.
      if (element?.closest('[role="menu"]')) {
        event.preventDefault()
        return
      }

      // The forwarded event is synthetic, so the clicked element comes only from
      // this real one; capture it before the trigger opens the menu.
      remember(event.target)
      event.preventDefault()
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
        })
      )
    }

    document.addEventListener('contextmenu', forward, true)
    return () => document.removeEventListener('contextmenu', forward, true)
  }, [])

  async function copy() {
    try {
      await writeClipboardText(targetRef.current.copyText)
    } catch {
      toast.error('Could not copy to the clipboard')
    }
  }

  async function paste() {
    const { field, range } = targetRef.current
    if (!field || !range) return

    try {
      const text = await readClipboardText()
      if (text === '') {
        toast.info('The clipboard is empty')
        return
      }
      insertClipboardText(field, range, text)
    } catch {
      toast.error('Could not paste from the clipboard')
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={triggerRef}
        className="contents"
        onContextMenu={(event) => {
          // The forwarded event targets the trigger itself; the clicked element
          // was already captured by the listener above.
          if (event.target === triggerRef.current) return
          remember(event.target)
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={target.copyText === ''}
          onSelect={() => void copy()}
        >
          Copy
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!target.canPaste}
          onSelect={() => void paste()}
        >
          Paste
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
