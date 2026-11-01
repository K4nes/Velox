import { toBlob } from 'html-to-image'

export type CardSaveOutcome = 'saved' | 'downloaded' | 'cancelled'

type SaveStream = {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

type SaveHandle = {
  createWritable: () => Promise<SaveStream>
}

type SavePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<SaveHandle>

type SaveWindow = Window & { showSaveFilePicker?: SavePicker }

async function renderCard(node: HTMLElement): Promise<Blob> {
  const { width, height } = node.getBoundingClientRect()
  const blob = await toBlob(node, {
    width: Math.round(width),
    height: Math.round(height),
    pixelRatio: 2,
  })
  if (blob === null) {
    throw new Error('The card could not be rendered as an image')
  }
  return blob
}

function isAbort(failure: unknown): boolean {
  return (
    typeof failure === 'object' &&
    failure !== null &&
    'name' in failure &&
    failure.name === 'AbortError'
  )
}

function saveDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  // Firefox ignores a click on an anchor that is not in the document.
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // The browser reads the URL after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function exportCard(node: HTMLElement, fileName: string): Promise<CardSaveOutcome> {
  const rendered = renderCard(node)
  // Cancelling the picker leaves this render unread. The no-op catch stops that
  // from reporting as an unhandled rejection; the later await still throws.
  void rendered.catch(() => undefined)

  // The dialog must open while the click still counts as user activation, so the
  // render is already running by the time the picker is awaited.
  const saveWindow: SaveWindow = window
  if (saveWindow.showSaveFilePicker === undefined) {
    saveDownload(await rendered, fileName)
    return 'downloaded'
  }

  let handle: SaveHandle
  try {
    handle = await saveWindow.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
    })
  } catch (failure) {
    if (isAbort(failure)) return 'cancelled'
    throw failure
  }

  const blob = await rendered
  const stream = await handle.createWritable()
  await stream.write(blob)
  await stream.close()
  return 'saved'
}
