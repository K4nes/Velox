import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Credential } from '@/lib/chain/connections'
import type { ProbeResult } from '@/lib/chain/connection-probes'

type KeysSectionProps = {
  testable: boolean
  connectionName: string
  credentials: Credential[]
  autoFallback: boolean
  probes: Record<string, { value: string; result: ProbeResult }>
  busy: Set<string>
  onPatch: (update: (credentials: Credential[]) => Credential[]) => void
  onValueChange: (credentialId: string, value: string) => void
  onAutoFallback: (value: boolean) => void
  onTest: (credential: Credential) => void
}

export function KeysSection({
  testable,
  connectionName,
  credentials,
  autoFallback,
  probes,
  busy,
  onPatch,
  onValueChange,
  onAutoFallback,
  onTest,
}: KeysSectionProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // Pressing the grip arms dragging and the drag handlers clear it, so a drag
  // inside the key input still selects text.
  const [armedId, setArmedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const inputs = useRef(new Map<string, HTMLInputElement>())

  useEffect(() => {
    if (focusId === null) {
      return
    }
    const input = inputs.current.get(focusId)
    if (input === undefined) {
      return
    }
    input.focus()
    setFocusId(null)
  }, [focusId, credentials])

  function addKey() {
    const id = crypto.randomUUID()
    onPatch((list) => [...list, { id, value: '' }])
    setFocusId(id)
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= credentials.length) {
      return
    }
    onPatch((list) => {
      const next = [...list]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function toggleReveal(id: string) {
    setRevealed((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function copy(credential: Credential, label: string) {
    try {
      await navigator.clipboard.writeText(credential.value)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Could not copy to the clipboard')
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold">API keys</h3>
          <Badge variant="secondary">{credentials.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <label
                htmlFor="auto-fallback"
                className="cursor-pointer text-[11px] font-medium text-muted-foreground"
              >
                Auto-fallback
              </label>
            </TooltipTrigger>
            <TooltipContent>
              Use the next key when one is rejected or rate-limited
            </TooltipContent>
          </Tooltip>
          <Switch
            id="auto-fallback"
            aria-label="Auto-fallback"
            checked={autoFallback}
            onCheckedChange={onAutoFallback}
          />
        </div>
      </div>

      {credentials.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No keys yet. Add one to start using {connectionName}.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {credentials.map((credential, index) => {
            const label = `Key ${index + 1}`
            const entry = probes[credential.id]
            const probe =
              entry !== undefined && entry.value === credential.value.trim()
                ? entry.result
                : undefined
            const busyWithProbe = busy.has(`key:${credential.id}`)
            const visible =
              revealed.has(credential.id) || focusedId === credential.id

            return (
              <div
                key={credential.id}
                draggable={armedId === credential.id}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(index))
                  setDraggingId(credential.id)
                }}
                onDragEnd={() => {
                  setArmedId(null)
                  setDraggingId(null)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const from = Number.parseInt(
                    event.dataTransfer.getData('text/plain'),
                    10
                  )
                  setDraggingId(null)
                  setArmedId(null)
                  if (Number.isInteger(from)) {
                    move(from, index)
                  }
                }}
                className={cn(
                  'flex items-center gap-2',
                  draggingId === credential.id && 'opacity-60'
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Reorder ${label}`}
                      onMouseDown={() => setArmedId(credential.id)}
                      onMouseUp={() => setArmedId(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          move(index, index - 1)
                        }
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          move(index, index + 1)
                        }
                      }}
                      className="cursor-grab text-muted-foreground active:cursor-grabbing"
                    >
                      <GripVertical />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Drag to reorder, or use the arrow keys
                  </TooltipContent>
                </Tooltip>

                <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>

                <div className="flex w-[104px] shrink-0 items-center gap-1.5">
                  <span className="text-xs font-medium">{label}</span>
                  {index === 0 && !autoFallback ? (
                    <Badge className="h-5 px-1.5 text-[11px]">Selected</Badge>
                  ) : null}
                </div>

                <Input
                  ref={(node) => {
                    if (node === null) {
                      inputs.current.delete(credential.id)
                    } else {
                      inputs.current.set(credential.id, node)
                    }
                  }}
                  type="text"
                  value={
                    visible ? credential.value : maskValue(credential.value)
                  }
                  onFocus={() => setFocusedId(credential.id)}
                  onBlur={() => setFocusedId(null)}
                  onChange={(event) =>
                    onValueChange(credential.id, event.target.value)
                  }
                  aria-label={`${label} value`}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="h-8 min-w-0 flex-1 font-mono text-xs"
                />

                {probe === undefined ? null : <ProbeBadge probe={probe} />}

                <div className="flex shrink-0 items-center gap-0.5">
                  {testable ? (
                    <RowAction
                      label={`Test ${label}`}
                      disabled={
                        busyWithProbe || credential.value.trim() === ''
                      }
                      onClick={() => onTest(credential)}
                    >
                      {busyWithProbe ? <Spinner className="size-3" /> : <Zap />}
                    </RowAction>
                  ) : null}
                  <RowAction
                    label={visible ? `Hide ${label}` : `Reveal ${label}`}
                    onClick={() => toggleReveal(credential.id)}
                  >
                    {visible ? <EyeOff /> : <Eye />}
                  </RowAction>
                  <RowAction
                    label={`Copy ${label}`}
                    onClick={() => void copy(credential, label)}
                  >
                    <Copy />
                  </RowAction>
                  <RowAction
                    label={`Remove ${label}`}
                    onClick={() =>
                      onPatch((list) =>
                        list.filter((entry) => entry.id !== credential.id)
                      )
                    }
                  >
                    <Trash2 />
                  </RowAction>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={addKey}
      >
        <Plus />
        Add key
      </Button>
    </section>
  )
}

type RowActionProps = {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}

function RowAction({ label, onClick, disabled = false, children }: RowActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function maskValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    return ''
  }
  // Four characters or fewer are the whole secret, so mask all of it.
  if (trimmed.length <= 4) {
    return '••••'
  }
  if (trimmed.length <= 10) {
    return `••••${trimmed.slice(-4)}`
  }
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`
}

function ProbeBadge({ probe }: { probe: ProbeResult }) {
  if (probe.ok && probe.warning !== null) {
    return (
      <Badge
        variant="outline"
        title={probe.detail}
        className="shrink-0 border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400"
      >
        Rate limited
      </Badge>
    )
  }

  if (probe.ok) {
    return (
      <Badge
        variant="outline"
        title={probe.warning ?? probe.detail}
        className="shrink-0 border-emerald-500/30 bg-emerald-500/10 font-mono text-[11px] text-emerald-600 dark:text-emerald-400"
      >
        {probe.latencyMs} ms
      </Badge>
    )
  }

  const rejected = probe.status === 401 || probe.status === 403
  return (
    <Badge
      variant="destructive"
      title={probe.error}
      className="shrink-0 text-[11px]"
    >
      {rejected ? 'Rejected' : 'Failed'}
    </Badge>
  )
}
