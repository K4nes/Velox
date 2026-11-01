export type EthUsdtPrice = { price: number; updatedAt: string }

export async function fetchEthUsdtPrice(): Promise<EthUsdtPrice> {
  const response = await fetch('/api/price/eth-usdt')
  const body = (await response.json().catch(() => null)) as
    | (EthUsdtPrice & { error?: string })
    | null

  if (!response.ok || body === null) {
    throw new Error(body?.error ?? 'Price request failed')
  }

  return body
}
