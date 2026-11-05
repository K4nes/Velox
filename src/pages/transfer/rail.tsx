import { SummaryRow } from '@/components/summary-row'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { WalletSelect } from '@/components/wallet-select'
import type { WalletGroup } from '@/components/wallet-select'
import type { TransferRunSummary } from '@/lib/transfer-run'
import { destinationLabel } from '@/lib/transfer-plan'
import type {
  DestinationResolution,
  TransferSelection,
} from '@/lib/transfer-plan'

export function TransferRail({
  groups,
  wallets,
  pickerSelection,
  onPickWallet,
  destinationText,
  onDestinationChange,
  destination,
  selections,
  summary,
  error,
  blockedReason,
  running,
  onTransfer,
}: {
  groups: WalletGroup[]
  wallets: readonly { address: string; label: string }[]
  pickerSelection: readonly string[]
  onPickWallet: (id: string) => void
  destinationText: string
  onDestinationChange: (value: string) => void
  destination: DestinationResolution
  selections: readonly TransferSelection[]
  summary: TransferRunSummary | null
  error: string | null
  blockedReason: string | null
  running: boolean
  onTransfer: () => void
}) {
  const units = selections.reduce(
    (sum, selection) => sum + selection.amount,
    0
  )
  const sources = new Set(
    selections.map((selection) => selection.from.address.toLowerCase())
  ).size
  const destinationMessage =
    destination.status === 'invalid' || destination.status === 'failed'
      ? destination.message
      : null
  const destinationValue =
    destination.status === 'ready'
      ? destinationLabel(destination.destination, wallets)
      : '—'

  return (
    <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[300px]">
      <Card className="shrink-0 gap-3 p-4">
        <h2 id="destination-wallet-label" className="text-[13px] font-semibold">
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
            placeholder="0x… or name.eth"
            disabled={running}
            aria-invalid={destinationMessage !== null}
            aria-describedby={
              destinationMessage !== null
                ? 'destination-address-error'
                : undefined
            }
          />
          {destinationMessage !== null ? (
            <p id="destination-address-error" className="text-destructive text-xs">
              {destinationMessage}
            </p>
          ) : null}
        </div>

        {destination.status === 'ready' ? (
          <p className="text-muted-foreground text-xs">
            {`Sends to ${destinationLabel(destination.destination, wallets)}`}
          </p>
        ) : null}
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex h-12 shrink-0 items-center border-b px-4">
          <h2 className="truncate text-[13px] font-semibold">Transfer</h2>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto p-4">
          <SummaryRow
            label="Selected"
            value={`${selections.length} ${selections.length === 1 ? 'token' : 'tokens'} · ${units} ${units === 1 ? 'unit' : 'units'}`}
          />
          <SummaryRow
            label="Source wallets"
            value={`${sources} ${sources === 1 ? 'wallet' : 'wallets'}`}
          />
          <SummaryRow label="Destination" value={destinationValue} />

          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}

          {summary && summary.total > 0 ? (
            <p className="text-muted-foreground text-xs">
              {summary.sent} of {summary.total} sent
              {summary.failed > 0 ? `, ${summary.failed} failed` : ''}
            </p>
          ) : null}
        </div>

        <div className="mt-auto shrink-0 border-t p-4">
          <Button
            className="h-10 w-full"
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
              `Transfer ${selections.length} ${selections.length === 1 ? 'NFT' : 'NFTs'}`
            )}
          </Button>
          {!running && blockedReason !== null && selections.length > 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">{blockedReason}</p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
