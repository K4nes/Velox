import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  applyBackup,
  backupCounts,
  backupFileName,
  backupJson,
  parseBackup,
  readBackup,
} from '@/lib/backup/backup'
import type { Backup, BackupCounts } from '@/lib/backup/backup'
import { toMessage } from '@/lib/core/message'

type DataSectionProps = {
  onImported: () => void
}

type Pending = { fileName: string; backup: Backup }

export function DataSection({ onImported }: DataSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function exportBackup() {
    setBusy(true)
    setError(null)
    try {
      const backup = await readBackup()
      saveJson(backupJson(backup), backupFileName(backup.exportedAt))
    } catch (failure) {
      setError(toMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  async function choose(file: File) {
    setError(null)
    setPending(null)
    try {
      const backup = parseBackup(await file.text())
      setPending({ fileName: file.name, backup })
    } catch (failure) {
      setError(toMessage(failure))
    }
  }

  async function confirm() {
    if (pending === null) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      await applyBackup(pending.backup)
      toast.success(`Imported ${describe(backupCounts(pending.backup))}`)
      setPending(null)
      onImported()
    } catch (failure) {
      setError(toMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex shrink-0 flex-col gap-0 overflow-hidden py-0">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="truncate text-[13px] font-semibold">Data</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void exportBackup()}
          >
            <Download data-icon="inline-start" />
            Export
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload data-icon="inline-start" />
            Import backup
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Wallets, folders, provider connections and PnL records travel in one
          JSON file. The file holds wallet private keys and provider API keys, so
          keep it where no one else can read it. An import replaces the rows it
          shares with this install and keeps the rest.
        </p>

        {error !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {pending !== null ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-2">
            <p className="text-xs">
              <span className="font-medium">{pending.fileName}</span> holds{' '}
              {describe(backupCounts(pending.backup))}.
            </p>
            <div className="flex items-center gap-2">
              <Button disabled={busy} onClick={() => void confirm()}>
                Import
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Uninstalling the Velox desktop app with &ldquo;delete app data&rdquo;
        ticked deletes its data folder, wallets and private keys included.
        Export a backup before you uninstall.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Clearing the value lets the operator pick the same file again once
          // it is fixed.
          event.target.value = ''
          if (file !== undefined) {
            void choose(file)
          }
        }}
      />
    </Card>
  )
}

function describe(counts: BackupCounts): string {
  return [
    plural(counts.wallets, 'wallet'),
    plural(counts.connections, 'connection'),
    plural(counts.folders, 'folder'),
    plural(counts.pnlRecords, 'PnL record'),
  ].join(', ')
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// A download rather than a save dialog: it needs no user activation, so the
// export can follow the read it waits on.
function saveJson(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  // Firefox ignores a click on an anchor that is not in the document.
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // The browser reads the URL after the click returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
