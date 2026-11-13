export type CaretField = HTMLInputElement | HTMLTextAreaElement

export type TextRange = { start: number; end: number }

export type MenuTarget = {
  field: CaretField | null
  range: TextRange | null
  copyText: string
  canPaste: boolean
}

// The selection API throws on input types that carry no caret, such as number,
// date, checkbox and radio.
const CARET_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'password',
  'email',
])

function isCaretField(node: EventTarget | null): node is CaretField {
  if (node instanceof HTMLTextAreaElement) return true
  return node instanceof HTMLInputElement && CARET_INPUT_TYPES.has(node.type)
}

function documentSelection(): string {
  return window.getSelection()?.toString() ?? ''
}

/**
 * Reads the click target and the text it offers now: the menu takes focus away,
 * so the field selection has to be captured before it opens.
 */
export function captureMenuTarget(node: EventTarget | null): MenuTarget {
  const field = isCaretField(node) ? node : null
  if (!field) {
    return {
      field: null,
      range: null,
      copyText: documentSelection(),
      canPaste: false,
    }
  }

  const length = field.value.length
  const range = {
    start: field.selectionStart ?? length,
    end: field.selectionEnd ?? length,
  }
  const selected = field.value.slice(range.start, range.end)
  const selection = documentSelection()
  // The field's selection wins, then the page's, then the whole value.
  const copyText = selected || selection || field.value

  return {
    field,
    range,
    copyText,
    canPaste: !field.readOnly && !field.disabled,
  }
}

/**
 * Inserts at the caret through the browser's own insertion command, which runs
 * the field's validation, length limit and React's change handler. Assigning
 * `.value` would leave React's state stale.
 */
export function insertClipboardText(
  field: CaretField,
  range: TextRange,
  text: string
): void {
  field.focus()
  field.setSelectionRange(range.start, range.end)
  if (!document.execCommand('insertText', false, text)) {
    throw new Error('The field did not accept the inserted text')
  }
}
