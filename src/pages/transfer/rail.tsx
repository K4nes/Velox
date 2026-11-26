import { X } from 'lucide-react'
import { useState } from 'react'

import { TokenImage } from '@/components/token-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { WalletSelect } from '@/components/wallet-select'
import type { WalletGroup } from '@/components/wallet-select'
import type { TransferSelectionGroup } from '@/hooks/scan/use-transfer-scan'
import { shortAddress } from '@/lib/core/format'
import type { TransferRunSummary } from '@/lib/transfer/transfer-run'
import { destinationLabel } from '@/lib/transfer/transfer-plan'
import type {
  DestinationResolution,
  TransferSelection,
} from '@/lib/transfer/transfer-plan'

export function TransferRail({
  groups,
  wallets,
  pickerSelection,
  onPickWallet,
  destinationText,
  onDestinationChange,
  destination,
  selections,
  selectionGroups,
  summary,
  error,
  blockedReason,
  running,
  onTransfer,
  onAmountChange,
  onRemoveToken,
  onRemoveGroup,
}: {
  groups: WalletGroup[]
  wallets: readonly { address: string; label: string }[]
  pickerSelection: readonly string[]
  onPickWallet: (id: string) => void
  destinationText: string
  onDestinationChange: (value: string) => void
  destination: DestinationResolution
  selections: readonly TransferSelection[]
  selectionGroups: readonly TransferSelectionGroup[]
  summary: TransferRunSummary | null
  error: string | null
  blockedReason: string | null
  running: boolean
  onTransfer: () => void
  onAmountChange: (key: string, amount: number) => void
  onRemoveToken: (key: string) => void
  onRemoveGroup: (contract: string) => void
}) {
  const sources = new Set(
    selections.map((selection) => selection.from.address.toLowerCase())
  ).size
  const units = selections.reduce((sum, entry) => sum + entry.amount, 0)
  const unitName = selections.some((entry) => entry.standard === 'erc1155')
    ? units === 1
      ? 'unit'
      : 'units'
    : units === 1
      ? 'NFT'
      : 'NFTs'
  const countLabel = `${units} ${unitName}`
  const sourcesLabel = `${sources} ${sources === 1 ? 'wallet' : 'wallets'}`
  const destinationMessage =
    destination.status === 'invalid' || destination.status === 'failed'
      ? destination.message
      : null
  const [touched, setTouched] = useState(false)
  const showDestinationError = touched && destinationMessage !== null
  const hideBlockedReason =
    showDestinationError && blockedReason === destinationMessage

  return (
    <div className="flex w-full shrink-0 flex-col xl:w-[340px]">
      <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <h2 className="truncate text-[13px] font-semibold">Transfer</h2>
          <Badge variant="secondary">{countLabel}</Badge>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex flex-col gap-3">
            <h2
              id="destination-wallet-label"
              className="text-[13px] font-semibold"
            >
              Destination wallet
            </h2>

            <WalletSelect
              groups={groups}
              selected={[...pickerSelection]}
              onSelectedChange={(ids) => {
                const [id] = ids
                if (id) onPickWallet(id)
              }}
              single
              disabled={running}
              aria-labelledby="destination-wallet-label"
              className="w-full"
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="destination-address" className="text-xs font-medium">
                Or paste an address
              </label>
              <Input
                id="destination-address"
                value={destinationText}
                onChange={(event) => onDestinationChange(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="0x… or name.eth"
                disabled={running}
                aria-invalid={showDestinationError || undefined}
                aria-describedby={
                  showDestinationError
                    ? 'destination-address-error'
                    : undefined
                }
              />
              {showDestinationError ? (
                <p
                  id="destination-address-error"
                  className="text-destructive text-xs"
                >
                  {destinationMessage}
                </p>
              ) : null}
            </div>

            {destination.status === 'ready' ? (
              <p className="text-muted-foreground text-xs">
                {`Sends to ${destinationLabel(destination.destination, wallets)}`}
              </p>
            ) : null}
          </div>

          {selectionGroups.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Select NFTs to transfer.
            </p>
          ) : null}

          {selectionGroups.map((group) => {
            const groupUnits = group.tokens.reduce(
              (sum, token) => sum + token.amount,
              0
            )
            const groupUnitName = group.tokens.some(
              (token) => token.standard === 'erc1155'
            )
              ? groupUnits === 1
                ? 'unit'
                : 'units'
              : groupUnits === 1
                ? 'NFT'
                : 'NFTs'

            return (
              <div
                key={group.contract.toLowerCase()}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <TokenImage src={group.imageUrl} alt={group.name} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium">
                      {group.name}
                    </span>
                    <span className="text-muted-foreground truncate font-mono text-[11px]">
                      {shortAddress(group.contract)}
                    </span>
                  </div>
                  <Badge variant="secondary">
                    {groupUnits} {groupUnitName}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove all ${group.name}`}
                    onClick={() => onRemoveGroup(group.contract)}
                    disabled={running}
                  >
                    <X />
                  </Button>
                </div>

                <div className="ml-3.5 flex flex-col gap-1 border-l pl-3">
                  {group.tokens.map((token) => (
                    <div key={token.key} className="flex items-center gap-2">
                      <span
                        className="max-w-[72px] shrink-0 truncate font-mono text-[11px] font-semibold tabular-nums"
                        title={`#${token.tokenId}`}
                      >
                        #{token.tokenId}
                      </span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                        {token.ownerLabel}
                      </span>
                      {token.standard === 'erc1155' ? (
                        <>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={token.available}
                            step={1}
                            value={token.amount}
                            disabled={running}
                            aria-label={`Units to transfer for token #${token.tokenId}`}
                            onFocus={(event) =>
                              event.currentTarget.select()
                            }
                            onChange={(event) =>
                              onAmountChange(
                                token.key,
                                Number(event.target.value)
                              )
                            }
                            className="h-7 w-16 px-1.5 text-right text-xs tabular-nums"
                          />
                          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                            / {token.available}
                          </span>
                        </>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove #${token.tokenId}`}
                        onClick={() => onRemoveToken(token.key)}
                        disabled={running}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-auto shrink-0 border-t p-4">
          <p className="text-muted-foreground text-xs">
            {countLabel} · {sourcesLabel}
          </p>

          {summary && summary.total > 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {summary.sent} of {summary.total} sent
              {summary.units > 0
                ? ` · ${summary.units} ${
                    summary.units === 1 ? 'unit' : 'units'
                  } moved`
                : ''}
              {summary.failed > 0 ? `, ${summary.failed} failed` : ''}
              {summary.unknown > 0
                ? `, ${summary.unknown} unconfirmed`
                : ''}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-destructive mt-1 text-xs">
              {error}
            </p>
          ) : null}

          <Button
            className="mt-3 h-10 w-full"
            onClick={onTransfer}
            disabled={running || blockedReason !== null}
          >
            {running ? (
              <>
                <Spinner data-icon="inline-start" />
                Sending…
              </>
            ) : selections.length === 0 ? (
              'Select NFTs to transfer'
            ) : (
              `Transfer ${countLabel}`
            )}
          </Button>

          {!running &&
          blockedReason !== null &&
          selections.length > 0 &&
          !hideBlockedReason ? (
            <p className="text-muted-foreground mt-2 text-xs">{blockedReason}</p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
