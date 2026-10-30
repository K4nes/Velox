import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Folder, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type WalletProfile = {
  id: string
  label: string
  address: string
  balance: number
}

type Folder = {
  id: string
  name: string
  wallets: WalletProfile[]
}

const chains = ['Robinhood']

const initialFolders: Folder[] = [
  {
    id: 'burners',
    name: 'Burners',
    wallets: [
      {
        id: 'main-burners-01',
        label: 'Main Burners 01',
        address: '0x1a2b…9f01',
        balance: 0.42,
      },
      {
        id: 'main-burners-02',
        label: 'Main Burners 02',
        address: '0x3c4d…7e02',
        balance: 0.25,
      },
      { id: 'burner-01', label: 'Burner 01', address: '0x7e5f…2b10', balance: 0.08 },
    ],
  },
  { id: 'unassigned', name: 'Unassigned', wallets: [] },
]

function formatEth(value: number) {
  return `${value.toFixed(4)} ETH`
}

function walletCount(count: number) {
  return `${count} wallet${count === 1 ? '' : 's'}`
}

function folderBalance(folder: Folder) {
  return folder.wallets.reduce((total, wallet) => total + wallet.balance, 0)
}

function uid() {
  try {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // randomUUID throws on non-secure origins; fall through to the fallback id.
  }
  return `wallet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

type ImportRow = { name: string }

// The key is only checked for presence here: it never reaches the folder list or
// the table. The pasted text stays in `importText` until an import succeeds or the
// active folder changes.
function parseImport(text: string) {
  const rows: ImportRow[] = []
  const errors: string[] = []

  text.split('\n').forEach((line, index) => {
    const entry = line.trim()
    if (!entry) {
      return
    }

    const separator = entry.indexOf(',')
    const name = separator === -1 ? '' : entry.slice(0, separator).trim()
    const privateKey = separator === -1 ? '' : entry.slice(separator + 1).trim()

    if (separator === -1) {
      errors.push(`Line ${index + 1}: expected name,private key`)
    } else if (!name) {
      errors.push(`Line ${index + 1}: name missing`)
    } else if (!privateKey) {
      errors.push(`Line ${index + 1}: private key missing`)
    } else {
      rows.push({ name })
    }
  })

  return { rows, errors }
}

export function WalletProfilesPage() {
  const [folders, setFolders] = useState(initialFolders)
  const [activeFolderId, setActiveFolderId] = useState(initialFolders[0].id)
  const [chain, setChain] = useState(chains[0])
  const [folderName, setFolderName] = useState('')
  const [importText, setImportText] = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const [attempted, setAttempted] = useState(false)

  const importRef = useRef<HTMLTextAreaElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<number | null>(null)
  const folderListRef = useRef<HTMLDivElement>(null)
  const folderNameRef = useRef<HTMLInputElement>(null)
  const pendingFolderFocus = useRef(false)

  const activeFolder = folders.find((folder) => folder.id === activeFolderId)
  const { rows, errors } = useMemo(() => parseImport(importText), [importText])
  const showErrors = attempted && errors.length > 0

  useLayoutEffect(() => {
    if (pendingFolderFocus.current) {
      pendingFolderFocus.current = false
      const row = folderListRef.current?.querySelector<HTMLButtonElement>(
        '[aria-current="true"]'
      )
      const target = row ?? folderNameRef.current
      target?.focus()
      return
    }

    const index = pendingFocus.current
    if (index === null) {
      return
    }
    pendingFocus.current = null
    const buttons = tableRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-wallet-remove]'
    )
    if (!buttons || buttons.length === 0) {
      importRef.current?.focus()
      return
    }
    buttons[Math.min(index, buttons.length - 1)].focus()
  })

  let importHint = ''
  if (showErrors) {
    importHint =
      errors.length > 1 ? `${errors[0]} (+${errors.length - 1} more)` : errors[0]
  } else if (errors.length === 0 && rows.length > 0) {
    importHint = `${walletCount(rows.length)} ready`
  } else if (importedCount > 0) {
    importHint = `Imported ${walletCount(importedCount)}`
  }

  const profileCount = folders.reduce(
    (total, folder) => total + folder.wallets.length,
    0
  )
  const totalBalance = folders.reduce(
    (total, folder) => total + folderBalance(folder),
    0
  )

  const stats = [
    { label: 'Total wallets', value: String(profileCount) },
    { label: 'Folders', value: String(folders.length) },
    {
      label: 'Total balance',
      value: formatEth(totalBalance),
      tone: 'text-success',
    },
  ]

  const resetImport = () => {
    setImportText('')
    setImportedCount(0)
    setAttempted(false)
  }

  const createFolder = () => {
    const name = folderName.trim()
    if (!name) {
      return
    }

    const folder: Folder = { id: uid(), name, wallets: [] }
    setFolders((current) => [...current, folder])
    setActiveFolderId(folder.id)
    setFolderName('')
    resetImport()
    folderNameRef.current?.focus()
  }

  const deleteFolder = () => {
    if (!activeFolder) {
      return
    }

    const remaining = folders.filter((folder) => folder.id !== activeFolder.id)
    setFolders(remaining)
    setActiveFolderId(remaining[0]?.id ?? '')
    resetImport()
    pendingFolderFocus.current = true
  }

  const importWallets = (parsed: ImportRow[]) => {
    if (!activeFolder || parsed.length === 0) {
      return
    }

    const wallets: WalletProfile[] = parsed.map((row) => ({
      id: uid(),
      label: row.name,
      address: '—',
      balance: 0,
    }))

    setFolders((current) =>
      current.map((folder) =>
        folder.id === activeFolder.id
          ? { ...folder, wallets: [...folder.wallets, ...wallets] }
          : folder
      )
    )
    resetImport()
    setImportedCount(parsed.length)
  }

  const removeWallet = (walletId: string) => {
    if (!activeFolder) {
      return
    }

    const index = activeFolder.wallets.findIndex(
      (wallet) => wallet.id === walletId
    )
    pendingFocus.current = index === -1 ? null : index
    setImportedCount(0)

    setFolders((current) =>
      current.map((folder) =>
        folder.id === activeFolder.id
          ? {
              ...folder,
              wallets: folder.wallets.filter((wallet) => wallet.id !== walletId),
            }
          : folder
      )
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <dl className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="gap-1 px-4">
            <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {stat.label}
            </dt>
            <dd className={cn('text-lg font-semibold tabular-nums', stat.tone)}>
              {stat.value}
            </dd>
          </Card>
        ))}
      </dl>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex w-full shrink-0 flex-col gap-0 overflow-hidden py-0 lg:w-[340px]">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold">Folders</h2>
              <Badge variant="secondary">{folders.length}</Badge>
            </div>
          </div>

          <div ref={folderListRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {folders.map((folder) => {
              const active = folder.id === activeFolder?.id
              const funded = folderBalance(folder) > 0

              return (
                <button
                  key={folder.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    if (folder.id === activeFolder?.id) {
                      return
                    }
                    setActiveFolderId(folder.id)
                    resetImport()
                  }}
                  className={cn(
                    'flex h-16 w-full shrink-0 items-center gap-2.5 rounded-sm px-3 text-left transition-colors ease-out',
                    active ? 'bg-muted' : 'hover:bg-muted/50'
                  )}
                >
                  <Folder aria-hidden className="text-muted-foreground size-4 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={cn(
                        'truncate text-[13px]',
                        active ? 'font-semibold' : 'font-medium'
                      )}
                    >
                      {folder.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">
                        {walletCount(folder.wallets.length)}
                      </span>
                      <span
                        className={cn(
                          'font-medium tabular-nums',
                          funded ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {formatEth(folderBalance(folder))}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        funded ? 'bg-success' : 'bg-muted-foreground'
                      )}
                    />
                    <span
                      className={cn(
                        'text-xs font-medium',
                        funded
                          ? active
                            ? 'text-foreground'
                            : 'text-success'
                          : 'text-muted-foreground'
                      )}
                    >
                      {funded ? 'Funded' : 'Unfunded'}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                </button>
              )
            })}
          </div>

          <form
            className="flex shrink-0 items-center gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault()
              createFolder()
            }}
          >
            <label htmlFor="folder-name" className="sr-only">
              Folder name
            </label>
            <Input
              id="folder-name"
              ref={folderNameRef}
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Folder name"
            />
            <Button type="submit" disabled={!folderName.trim()}>
              <Plus />
              Create
            </Button>
          </form>
        </Card>

        <Card className="flex min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
          {activeFolder ? (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-[13px] font-semibold">
                    {activeFolder.name}
                  </h2>
                  <Badge
                    variant="secondary"
                    className="hidden shrink-0 xl:inline-flex"
                  >
                    {walletCount(activeFolder.wallets.length)}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Select value={chain} onValueChange={setChain}>
                    <SelectTrigger aria-label="Chain" className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {chains.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Check balances"
                    disabled
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    aria-label={`Delete folder ${activeFolder.name}`}
                    onClick={(event) => {
                      if (event.detail > 1) {
                        return
                      }
                      deleteFolder()
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <div ref={tableRef} className="min-h-0 flex-1">
                <Table aria-label={`Wallets in ${activeFolder.name}`}>
                  <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted">
                    <TableRow>
                      <TableHead className="text-muted-foreground w-[300px] px-3 text-xs font-medium">
                        Wallet
                      </TableHead>
                      <TableHead className="text-muted-foreground w-[220px] px-3 text-xs font-medium">
                        Address
                      </TableHead>
                      <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                        ETH balance
                      </TableHead>
                      <TableHead className="w-[72px] px-3">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeFolder.wallets.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={4}
                          className="text-muted-foreground h-24 text-center"
                        >
                          No wallets in this folder yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeFolder.wallets.map((wallet) => (
                        <TableRow
                          key={wallet.id}
                          className="h-16 hover:bg-transparent"
                        >
                          <TableCell className="px-3 text-[13px] font-medium">
                            {wallet.label}
                          </TableCell>
                          <TableCell className="text-muted-foreground px-3 text-xs">
                            {wallet.address}
                          </TableCell>
                          <TableCell className="px-3 text-[13px] font-medium tabular-nums">
                            {formatEth(wallet.balance)}
                          </TableCell>
                          <TableCell className="px-3">
                            <Button
                              data-wallet-remove
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${wallet.label}`}
                              onClick={(event) => {
                                if (event.detail > 1) {
                                  return
                                }
                                removeWallet(wallet.id)
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <form
                className="flex shrink-0 flex-col gap-2 border-t px-4 py-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (errors.length > 0) {
                    setAttempted(true)
                    return
                  }
                  importWallets(rows)
                  importRef.current?.focus()
                }}
              >
                <label htmlFor="wallet-import" className="text-xs font-medium">
                  Import wallets
                </label>
                <Textarea
                  id="wallet-import"
                  ref={importRef}
                  value={importText}
                  onChange={(event) => {
                    setImportText(event.target.value)
                    setImportedCount(0)
                    setAttempted(false)
                  }}
                  rows={3}
                  placeholder={'Main Burners 03,<private key>\nBurner 04,<private key>'}
                  aria-describedby="wallet-import-hint"
                  aria-invalid={showErrors}
                  className="max-h-[200px] resize-none font-mono"
                />
                <div className="flex items-center justify-between gap-3">
                  <p
                    id="wallet-import-hint"
                    role="status"
                    className={cn(
                      'text-xs',
                      showErrors
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    {importHint}
                  </p>
                  <Button type="submit" disabled={!importText.trim()}>
                    <Plus />
                    Import
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4">
              <EmptyState
                icon={Folder}
                title="No folders yet"
                description="Create a folder to group wallets."
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
