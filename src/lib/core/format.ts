import { formatUnits } from 'viem'

export function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address
}

export function formatAmount(amount: bigint, decimals: number): string {
  const [whole, fraction] = formatUnits(amount, decimals).split('.')
  const trimmed = (fraction ?? '').slice(0, 6).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

export function formatExpiry(sec: number, now: number): string {
  const diff = sec - now
  if (diff <= 0) return 'expired'
  if (diff >= 86_400) return `${Math.floor(diff / 86_400)}d`
  if (diff >= 3_600) return `${Math.floor(diff / 3_600)}h`
  return `${Math.max(1, Math.floor(diff / 60))}m`
}
