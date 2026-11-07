import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { chainBySlug, chains } from '@/config/chains'
import { useWalletBalances } from '@/hooks/use-wallet-balances'
import { getAll, put, remove } from '@/lib/db'
import { toMessage } from '@/lib/error-message'
import {
  importWallets,
  listWallets,
  parseWalletLines,
  removeWallet,
} from '@/lib/wallets'
import type { StoredWallet } from '@/lib/wallets'
import {
  folderBalance,
  folderState,
  formatBalance,
  persistChain,
  readStoredChain,
  toFolders,
  uid,
  walletCount,
} from '@/lib/wallet-model'
import type { FolderRecord } from '@/lib/wallet-model'
import { cn } from '@/lib/utils'

export function WalletProfilesPage() {
  const [folderRecords, setFolderRecords] = useState<FolderRecord[]>([])
  const [walletRecords, setWalletRecords] = useState<StoredWallet[]>([])
  const [activeFolderId, setActiveFolderId] = useState('')
  const [chainSlug, setChainSlug] = useState(
    () => readStoredChain() ?? chains[0].slug
  )
  const [storageError, setStorageError] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')
  const [importText, setImportText] = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const activeFolderIdRef = useRef('')
  const [attempted, setAttempted] = useState(false)

  const importRef = useRef<HTMLTextAreaElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<number | null>(null)
  const folderListRef = useRef<HTMLDivElement>(null)
  const folderNameRef = useRef<HTMLInputElement>(null)
  const pendingFolderFocus = useRef(false)
  const creatingRef = useRef(false)

  const applyRecords = (folders: FolderRecord[], wallets: StoredWallet[]) => {
    setFolderRecords([...folders].sort((a, b) => a.createdAt - b.createdAt))
    setWalletRecords([...wallets].sort((a, b) => a.createdAt - b.createdAt))
  }

  const reportStorage = (failure: unknown) => {
    setStorageError(toMessage(failure))
  }

  const reload = async () => {
    const [folders, wallets] = await Promise.all([
      getAll<FolderRecord>('folders'),
      listWallets(),
    ])
    applyRecords(folders, wallets)
  }

  useEffect(() => {
    let cancelled = false

    Promise.all([getAll<FolderRecord>('folders'), listWallets()])
      .then(([folders, wallets]) => {
        if (cancelled) {
          return
        }
        applyRecords(folders, wallets)
      })
      .catch((failure) => {
        if (!cancelled) {
          reportStorage(failure)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  // The tile sums every folder, so every folder's wallets have to be fetched or
  // the rest of the page reports "Unfunded" for balances it never asked for.
  const addressKey = useMemo(() => {
    const addresses = new Set<string>()
    for (const folder of folderRecords) {
      for (const wallet of walletRecords) {
        if (wallet.folderId === folder.id) {
          addresses.add(wallet.address)
        }
      }
    }
    return [...addresses].join(',')
  }, [folderRecords, walletRecords])

  const {
    balances,
    loading: balanceLoading,
    errorMessage: visibleBalanceError,
    runRefresh,
  } = useWalletBalances(chainSlug, addressKey)

  const folders = useMemo(
    () => toFolders(folderRecords, walletRecords, balances, chainSlug),
    [folderRecords, walletRecords, balances, chainSlug]
  )

  const activeFolder =
    folders.find((folder) => folder.id === activeFolderId) ?? folders[0]
  const activeChain = chainBySlug(chainSlug) ?? chains[0]

  useEffect(() => {
    activeFolderIdRef.current = activeFolder?.id ?? ''
  }, [activeFolder?.id])

  const { rows, errors } = useMemo(() => parseWalletLines(importText), [importText])
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
  }, [walletRecords, folderRecords])

  let importHint = ''
  if (showErrors) {
    importHint =
      errors.length > 1 ? `${errors[0]} (+${errors.length - 1} more)` : errors[0]
  } else if (errors.length === 0 && rows.length > 0) {
    importHint = `${walletCount(rows.length)} ready`
  } else if (importedCount > 0 || skippedCount > 0) {
    importHint = [
      importedCount > 0 ? `Imported ${walletCount(importedCount)}` : '',
      skippedCount > 0 ? `${skippedCount} already present` : '',
    ]
      .filter(Boolean)
      .join(', ')
  }

  const profileCount = folders.reduce(
    (total, folder) => total + folder.wallets.length,
    0
  )
  const totalBalance = folders.reduce(
    (total, folder) => total + folderBalance(folder),
    0n
  )
  const totalKnown = folders.every((folder) =>
    folder.wallets.every((wallet) => wallet.balance !== null)
  )

  const stats = [
    { label: 'Total wallets', value: String(profileCount) },
    { label: 'Folders', value: String(folders.length) },
    {
      label: 'Total balance',
      value: totalKnown
        ? formatBalance(totalBalance, activeChain.currency.symbol)
        : '—',
      tone: 'text-success',
    },
  ]

  const resetImport = () => {
    setImportText('')
    setImportedCount(0)
    setSkippedCount(0)
    setAttempted(false)
  }

  const createFolder = async () => {
    const name = folderName.trim()
    if (!name || creatingRef.current) {
      return
    }

    creatingRef.current = true
    // Captured from the render closure: until the reload lands, the re-render
    // falls back to folders[0], so a later read would restore the wrong folder.
    const previousFolderId = activeFolder?.id ?? ''
    const folder: FolderRecord = { id: uid(), name, createdAt: Date.now() }
    setStorageError(null)
    try {
      await put('folders', folder)
    } catch (failure) {
      reportStorage(failure)
      return
    } finally {
      creatingRef.current = false
    }
    // The write landed, so the folder exists. Select it before the read: a failed
    // reload would otherwise leave it invisible while the name stays in the input,
    // and the retry writes a second folder with the same name.
    setActiveFolderId(folder.id)
    setFolderName('')
    resetImport()
    folderNameRef.current?.focus()
    try {
      await reload()
    } catch (failure) {
      reportStorage(failure)
      // The new folder is not in the records the page renders, so the panel falls
      // back to another folder while the id still names this one. Follow the
      // folder that is actually on screen instead of a selection nothing shows.
      setActiveFolderId((current) =>
        current === folder.id ? previousFolderId : current
      )
    }
  }

  const deleteFolder = async () => {
    if (!activeFolder || deleting || importing) {
      return
    }
    setDeleting(true)

    const folderId = activeFolder.id
    let owned: StoredWallet[]
    try {
      owned = (await listWallets()).filter(
        (wallet) => wallet.folderId === folderId
      )
    } catch (failure) {
      reportStorage(failure)
      setDeleting(false)
      return
    }

    setStorageError(null)
    let removed = false
    try {
      // Wallets first: a failed wallet delete with the folder already gone
      // would leave keys this page can no longer reach.
      await Promise.all(owned.map((wallet) => removeWallet(wallet.id)))
      await remove('folders', folderId)
      removed = true
    } catch (failure) {
      reportStorage(failure)
    }
    let reloaded = false
    try {
      await reload()
      reloaded = true
    } catch (failure) {
      reportStorage(failure)
    }
    // The folder is still there when the write failed, so the selection, the
    // pasted import text and the focus stay where the operator left them.
    if (!removed) {
      setDeleting(false)
      return
    }
    if (!reloaded) {
      // The delete landed but the read did not. Drop the dead folder from what is
      // rendered, or its import form keeps writing wallets under a folder id that
      // no longer exists and nothing on this page can reach them again.
      applyRecords(
        folderRecords.filter((folder) => folder.id !== folderId),
        walletRecords.filter((wallet) => wallet.folderId !== folderId)
      )
    }
    // The operator can open another folder while the delete runs. Reset only the
    // one this delete emptied, or their selection, draft and focus are lost.
    if (activeFolderIdRef.current === folderId) {
      setActiveFolderId('')
      resetImport()
      // The flag is safe once the records for this delete are on screen, whether
      // they came from the read or from the local reconcile above.
      pendingFolderFocus.current = true
    }
    setDeleting(false)
  }

  const handleImport = async (parsed: { label: string; privateKey: string }[]) => {
    if (!activeFolder || parsed.length === 0 || importing || deleting) {
      return
    }

    setStorageError(null)
    setImporting(true)
    const folderId = activeFolder.id
    try {
      const { imported, skipped } = await importWallets(folderId, parsed)
      if (activeFolderIdRef.current === folderId) {
        resetImport()
        setImportedCount(imported)
        setSkippedCount(skipped)
      }
    } catch (failure) {
      reportStorage(failure)
    } finally {
      setImporting(false)
    }
    try {
      await reload()
    } catch (failure) {
      reportStorage(failure)
    }
  }

  const removeWalletById = async (walletId: string) => {
    if (!activeFolder) {
      return
    }

    const index = activeFolder.wallets.findIndex(
      (wallet) => wallet.id === walletId
    )

    try {
      await removeWallet(walletId)
    } catch (failure) {
      pendingFocus.current = null
      reportStorage(failure)
      return
    }

    // Set after the write: any commit during the await would spend the index
    // on a row that still exists.
    pendingFocus.current = index === -1 ? null : index
    try {
      await reload()
      // Clearing before the write re-renders with the row still present, which
      // spends the focus index on a button that is about to disappear.
      setStorageError(null)
      setImportedCount(0)
      setSkippedCount(0)
    } catch (failure) {
      // The delete landed but the read did not. Drop the row from what is
      // rendered, or it keeps a balance for a key that is gone.
      applyRecords(
        folderRecords,
        walletRecords.filter((wallet) => wallet.id !== walletId)
      )
      pendingFocus.current = null
      reportStorage(failure)
    }
  }

  function selectChain(slug: string) {
    setChainSlug(slug)
    persistChain(slug)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      {storageError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-destructive text-xs">
            Wallet storage error. {storageError}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStorageError(null)
              void reload().catch(reportStorage)
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
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
              const state = folderState(folder)
              const funded = state === 'funded'

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
                        {state === 'unknown'
                          ? '—'
                          : formatBalance(
                              folderBalance(folder),
                              activeChain.currency.symbol
                            )}
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
                      {state === 'unknown'
                        ? '—'
                        : funded
                          ? 'Funded'
                          : 'Unfunded'}
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
              void createFolder()
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
                  <Select value={chainSlug} onValueChange={selectChain}>
                    <SelectTrigger aria-label="Chain" className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      {chains.map((option) => (
                        <SelectItem key={option.slug} value={option.slug}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Check balances"
                    aria-busy={balanceLoading}
                    disabled={balanceLoading || !addressKey}
                    onClick={() => void runRefresh(addressKey.split(','))}
                  >
                    <RefreshCw className={cn(balanceLoading && 'animate-spin')} />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    aria-label={`Delete folder ${activeFolder.name}`}
                    disabled={importing || deleting}
                    onClick={(event) => {
                      if (event.detail > 1) {
                        return
                      }
                      void deleteFolder()
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              {visibleBalanceError ? (
                <p
                  role="alert"
                  className="text-destructive shrink-0 border-b px-4 py-2 text-xs"
                >
                  {visibleBalanceError}
                </p>
              ) : null}

              <div ref={tableRef} className="min-h-0 flex-1">
                <Table aria-label={`Wallets in ${activeFolder.name}`} className="table-fixed">
                  <TableHeader className="[&_tr]:bg-muted [&_tr]:hover:bg-muted [&_th]:h-8">
                    <TableRow>
                      <TableHead className="text-muted-foreground w-[30%] px-3 text-xs font-medium">
                        Wallet
                      </TableHead>
                      <TableHead className="text-muted-foreground w-auto px-3 text-xs font-medium">
                        Address
                      </TableHead>
                      <TableHead className="text-muted-foreground w-[96px] px-3 text-right text-xs font-medium">
                        Balance
                      </TableHead>
                      <TableHead className="w-[48px] px-3">
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
                          className="h-11 hover:bg-transparent"
                        >
                          <TableCell className="px-3 text-[13px] font-medium">
                            <span className="block truncate">{wallet.label}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground px-3 text-xs">
                            <span className="block truncate">{wallet.address}</span>
                          </TableCell>
                          <TableCell className="px-3 text-right text-[13px] font-medium tabular-nums">
                            {wallet.balance === null
                              ? '—'
                              : formatBalance(
                                  wallet.balance,
                                  activeChain.currency.symbol
                                )}
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
                                void removeWalletById(wallet.id)
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
                  void handleImport(rows)
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
                    setSkippedCount(0)
                    setAttempted(false)
                  }}
                  rows={3}
                  readOnly={importing}
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
                  <Button
                    type="submit"
                    disabled={!importText.trim() || importing || deleting}
                  >
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
