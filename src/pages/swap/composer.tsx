import { ArrowRight } from 'lucide-react'

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
import { WalletSelect } from '@/components/wallet-select'
import type { WalletGroup } from '@/components/wallet-select'
import { chains } from '@/config/chains'
import type { ChainSlug } from '@/config/chains'
import { assetKey, assetOptions } from '@/config/swap-assets'
import {
  SLIPPAGE_OPTIONS,
  withAmountText,
  withDestinationAsset,
  withDestinationChain,
  withMaxAmount,
  withOriginAsset,
  withOriginChain,
  withSlippage,
} from '@/lib/swap-spec'
import type { SwapSpec } from '@/lib/swap-spec'

export function SwapComposer({
  groups,
  walletIds,
  onWalletIdsChange,
  spec,
  onSpecChange,
  disabled,
}: {
  groups: WalletGroup[]
  walletIds: string[]
  onWalletIdsChange: (ids: string[]) => void
  spec: SwapSpec
  onSpecChange: (spec: SwapSpec) => void
  disabled: boolean
}) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div
          className="flex flex-col gap-1.5 lg:w-[280px]"
          role="group"
          aria-labelledby="swap-wallet-label"
        >
          <span id="swap-wallet-label" className="text-xs font-medium">
            Wallet
          </span>
          <WalletSelect
            groups={groups}
            selected={walletIds}
            onSelectedChange={onWalletIdsChange}
            disabled={disabled}
            aria-labelledby="swap-wallet-label"
            className="w-full"
          />
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="swap-origin-chain" className="text-xs font-medium">
            Origin chain
          </label>
          <Select
            value={spec.from.chain}
            onValueChange={(value) =>
              onSpecChange(withOriginChain(spec, value as ChainSlug))
            }
            disabled={disabled}
          >
            <SelectTrigger id="swap-origin-chain" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chains.map((chain) => (
                <SelectItem key={chain.slug} value={chain.slug}>
                  {chain.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="swap-destination-chain" className="text-xs font-medium">
            Destination chain
          </label>
          <Select
            value={spec.to.chain}
            onValueChange={(value) =>
              onSpecChange(withDestinationChain(spec, value as ChainSlug))
            }
            disabled={disabled}
          >
            <SelectTrigger id="swap-destination-chain" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {chains.map((chain) => (
                <SelectItem key={chain.slug} value={chain.slug}>
                  {chain.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 lg:w-[200px]">
          <label htmlFor="swap-slippage" className="text-xs font-medium">
            Slippage tolerance
          </label>
          <Select
            value={spec.slippageBps === null ? 'auto' : String(spec.slippageBps)}
            onValueChange={(value) =>
              onSpecChange(
                withSlippage(spec, value === 'auto' ? null : Number(value))
              )
            }
            disabled={disabled}
          >
            <SelectTrigger id="swap-slippage" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLIPPAGE_OPTIONS.map((option) => (
                <SelectItem
                  key={option.label}
                  value={option.bps === null ? 'auto' : String(option.bps)}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="swap-sell-asset" className="text-xs font-medium">
            Sell asset
          </label>
          <Select
            value={assetKey(spec.from.ref)}
            onValueChange={(value) =>
              onSpecChange(withOriginAsset(spec, value))
            }
            disabled={disabled}
          >
            <SelectTrigger id="swap-sell-asset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assetOptions(spec.from.chain).map((asset) => (
                <SelectItem key={assetKey(asset.ref)} value={assetKey(asset.ref)}>
                  {`${asset.symbol} · ${asset.name}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden shrink-0 pb-2 lg:block">
          <ArrowRight aria-hidden className="text-muted-foreground size-4" />
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="swap-buy-asset" className="text-xs font-medium">
            Buy asset
          </label>
          <Select
            value={assetKey(spec.to.ref)}
            onValueChange={(value) =>
              onSpecChange(withDestinationAsset(spec, value))
            }
            disabled={disabled}
          >
            <SelectTrigger id="swap-buy-asset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assetOptions(spec.to.chain).map((asset) => (
                <SelectItem key={assetKey(asset.ref)} value={assetKey(asset.ref)}>
                  {`${asset.symbol} · ${asset.name}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 lg:w-[240px]">
          <label htmlFor="swap-amount" className="text-xs font-medium">
            Amount
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="swap-amount"
              inputMode="decimal"
              placeholder={spec.amount.kind === 'max' ? 'Max' : '0.0'}
              value={spec.amount.kind === 'fixed' ? spec.amount.text : ''}
              onChange={(event) => {
                const next = event.target.value
                if (/^\d*\.?\d*$/.test(next)) {
                  onSpecChange(withAmountText(spec, next))
                }
              }}
              disabled={disabled}
            />
            <Button
              type="button"
              variant={spec.amount.kind === 'max' ? 'secondary' : 'outline'}
              aria-pressed={spec.amount.kind === 'max'}
              onClick={() => onSpecChange(withMaxAmount(spec))}
              disabled={disabled}
            >
              Max
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
