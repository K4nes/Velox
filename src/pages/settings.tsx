import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { chains } from '@/config/chains'
import { readSecret, writeSecret } from '@/lib/secrets'

export function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [rpcUrls, setRpcUrls] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<'api-key' | 'rpc' | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [key, ...urls] = await Promise.all([
          readSecret('opensea-api-key'),
          ...chains.map((chain) => readSecret(`rpc:${chain.slug}`)),
        ])

        if (cancelled) {
          return
        }

        setApiKey(key)
        setRpcUrls(
          Object.fromEntries(chains.map((chain, index) => [chain.slug, urls[index]]))
        )
      } catch (failure) {
        if (!cancelled) {
          setLoadFailed(true)
          setLoadError(
            failure instanceof Error ? failure.message : String(failure)
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  // The blocked-database error clears only when the other tab closes, so the
  // page needs a way back without a full reload.
  function retry() {
    setLoading(true)
    setLoadFailed(false)
    setLoadError(null)
    setReloadToken((token) => token + 1)
  }

  useEffect(() => {
    if (!saved) {
      return
    }

    const timer = window.setTimeout(() => setSaved(null), 2000)
    return () => window.clearTimeout(timer)
  }, [saved])

  async function saveApiKey() {
    try {
      await writeSecret('opensea-api-key', apiKey.trim())
      setLoadError(null)
      setSaved('api-key')
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  async function saveRpcUrls() {
    try {
      await Promise.all(
        chains.map((chain) =>
          writeSecret(`rpc:${chain.slug}`, (rpcUrls[chain.slug] ?? '').trim())
        )
      )
      setLoadError(null)
      setSaved('rpc')
    } catch (failure) {
      setLoadError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <p className="text-destructive text-xs">
            Settings storage error. {loadError}
          </p>
          {loadFailed ? (
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <h2 className="truncate text-[13px] font-semibold">OpenSea</h2>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <p className="text-muted-foreground text-xs">
            Required for every OpenSea call. Create one at
            opensea.io/settings?section=developers.
          </p>
          <label htmlFor="opensea-api-key" className="text-xs font-medium">
            API key
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="opensea-api-key"
              type="password"
              autoComplete="off"
              disabled={loading || loadFailed}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="max-w-md"
            />
            <Button
              onClick={() => void saveApiKey()}
              disabled={loading || loadFailed}
            >
              Save
            </Button>
            <p role="status" className="text-muted-foreground text-xs">
              {saved === 'api-key' ? 'Saved' : ''}
            </p>
          </div>
        </div>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <h2 className="truncate text-[13px] font-semibold">RPC</h2>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-muted-foreground text-xs">
            Leave a row empty to use the default endpoint for that chain.
          </p>
          {chains.map((chain) => (
            <div key={chain.slug} className="flex items-center gap-3">
              <label
                htmlFor={`rpc-${chain.slug}`}
                className="w-40 shrink-0 text-xs font-medium"
              >
                {chain.name}
              </label>
              <Input
                id={`rpc-${chain.slug}`}
                disabled={loading || loadFailed}
                placeholder={chain.rpcUrl || 'Not configured'}
                value={rpcUrls[chain.slug] ?? ''}
                onChange={(event) =>
                  setRpcUrls((current) => ({
                    ...current,
                    [chain.slug]: event.target.value,
                  }))
                }
                className="max-w-md"
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void saveRpcUrls()}
              disabled={loading || loadFailed}
            >
              Save
            </Button>
            <p role="status" className="text-muted-foreground text-xs">
              {saved === 'rpc' ? 'Saved' : ''}
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
