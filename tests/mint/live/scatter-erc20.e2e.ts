import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { createPublicClient, formatUnits, http, parseUnits } from 'viem'
import { chainByChainId } from '@/config/chains'
import {
  testRpc,
  liveWallet,
  openseaConnection,
  pinWalletChain,
} from '../../support/data'
import { requireEnv } from '../../support/env'
import { pinMintGas } from '../../support/mint'
import { seedVelox } from '../../support/seed'

const URL_LABEL = 'Collection URL or slug (OpenSea / Scatter)'

const balanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const allowanceAbi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

type Collection = {
  address: string
  chainId: number
  name: string
  standard: 'erc721' | 'erc1155' | 'unknown'
}

type MintList = {
  id: string
  name: string
  currencyAddress: string
  currencySymbol: string
  tokenPrice: string
  decimals: number
  unitSize: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Scatter answered ${response.status} for ${url}`)
  }
  return response.json()
}

// The balance this case reads is the ERC-721 `balanceOf(address)`. An ERC-1155 answers
// only the two-argument form, so the run would fail decoding a value rather than saying
// why. The provider ships the contract ABI, which states the form without a chain read.
function tokenStandard(abi: unknown): Collection['standard'] {
  let entries: unknown = abi
  if (typeof abi === 'string') {
    try {
      entries = JSON.parse(abi)
    } catch {
      return 'unknown'
    }
  }
  if (!Array.isArray(entries)) return 'unknown'
  const balanceOf = entries.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>).type === 'function' &&
      (entry as Record<string, unknown>).name === 'balanceOf'
  ) as { inputs?: unknown[] } | undefined
  if (!Array.isArray(balanceOf?.inputs)) return 'unknown'
  return balanceOf.inputs.length === 2 ? 'erc1155' : 'erc721'
}

async function readCollection(slug: string): Promise<Collection> {
  const body = (await readJson(
    `https://api.scatter.art/v1/collection/${encodeURIComponent(slug)}`
  )) as Record<string, unknown>
  const address = body.address
  const chainId = body.chain_id
  if (typeof address !== 'string' || typeof chainId !== 'number') {
    throw new Error(`Scatter returned no collection for ${slug}`)
  }
  return {
    address,
    chainId,
    name: String(body.name ?? ''),
    standard: tokenStandard(body.abi),
  }
}

// A collection can carry several lists, so the case names the one it spends on. Without
// the name it takes the first token-priced list, which is the one it is meant to prove.
async function readErc20List(
  slug: string,
  minter: string,
  name: string | undefined
): Promise<MintList> {
  const body = await readJson(
    `https://api.scatter.art/v1/collection/${encodeURIComponent(slug)}/eligible-invite-lists?minterAddress=${encodeURIComponent(minter)}`
  )
  if (!Array.isArray(body)) {
    throw new Error(`Scatter returned no lists for ${slug}`)
  }
  const lists = body
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null
    )
    .filter(
      (entry) =>
        String(entry.currency_address ?? '').toLowerCase() !== ZERO_ADDRESS
    )
    .map((entry) => ({
      id: String(entry.id),
      name: String(entry.name ?? ''),
      currencyAddress: String(entry.currency_address ?? ''),
      currencySymbol: String(entry.currency_symbol ?? ''),
      tokenPrice: String(entry.token_price ?? '0'),
      decimals: Number(entry.decimals ?? 18),
      unitSize: Number(entry.unit_size ?? 1),
    }))
  const list =
    name === undefined
      ? lists[0]
      : lists.find((entry) => entry.name.trim() === name.trim())
  if (list === undefined) {
    throw new Error(
      `${slug} answers no token-priced list named "${name ?? '(any)'}"; this case needs a real ERC-20 list`
    )
  }
  return list
}

const required = [
  'E2E_SCATTER_ERC20_SLUG',
  'E2E_SCATTER_ERC20_RPC_URL',
  'E2E_WALLET_KEY',
  'E2E_WALLET_LABEL',
  'E2E_WALLET_FOLDER',
]

const ready =
  process.env.E2E_ALLOW_MINT === '1' &&
  required.every((name) => Boolean(process.env[name]))

test(
  'a live ERC-20 Scatter list approves the collection, mints, and lands the NFT',
  {
    skip: ready
      ? false
      : 'set E2E_ALLOW_MINT=1 plus E2E_SCATTER_ERC20_SLUG, E2E_SCATTER_ERC20_RPC_URL, E2E_WALLET_KEY, E2E_WALLET_LABEL and E2E_WALLET_FOLDER; this case spends gas',
  },
  async ({ app, browser, screen }) => {
    const slug = requireEnv('E2E_SCATTER_ERC20_SLUG')
    const rpcUrl = requireEnv('E2E_SCATTER_ERC20_RPC_URL')
    const { folder, wallet } = liveWallet({
      privateKey: requireEnv('E2E_WALLET_KEY'),
      label: requireEnv('E2E_WALLET_LABEL'),
      folder: requireEnv('E2E_WALLET_FOLDER'),
    })

    const collection = await readCollection(slug)
    const chain = chainByChainId(collection.chainId)
    if (chain === undefined) {
      throw new Error(
        `${slug} is on chain ${collection.chainId}, which Velox cannot sign for`
      )
    }
    if (collection.standard === 'erc1155') {
      throw new Error(
        `${slug} is an ERC-1155 collection; this case reads the ERC-721 balance and needs an ERC-721 list`
      )
    }
    const list = await readErc20List(
      slug,
      wallet.address,
      process.env.E2E_SCATTER_ERC20_LIST
    )
    const amount = parseUnits(list.tokenPrice, list.decimals) * BigInt(list.unitSize)
    const amountLabel = `${formatUnits(amount, list.decimals)} ${list.currencySymbol}`

    const client = createPublicClient({ transport: http(rpcUrl) })
    const token = list.currencyAddress as `0x${string}`
    const owner = wallet.address as `0x${string}`
    const balanceOf = (owner: `0x${string}`) =>
      client.readContract({
        address: token,
        abi: balanceAbi,
        functionName: 'balanceOf',
        args: [owner],
      })

    // A short wallet fails here with its own number, before the browser signs anything.
    const balance = await balanceOf(owner)
    if (balance < amount) {
      throw new Error(
        `The live wallet holds ${formatUnits(balance, list.decimals)} ${list.currencySymbol}; the list needs ${amountLabel}. Fund it, or name a list it can pay`
      )
    }
    const gas = await client.getBalance({ address: owner })
    if (gas === 0n) {
      throw new Error(
        `The live wallet holds no ${chain.currency.symbol} on ${chain.name} to pay gas`
      )
    }
    // The case exists to prove an approval, so an allowance that already covers the
    // amount leaves it nothing to sign. Revoking costs gas the operator did not ask for.
    const approved = await client.readContract({
      address: token,
      abi: allowanceAbi,
      functionName: 'allowance',
      args: [owner, collection.address as `0x${string}`],
    })
    // A skip would report the lane green without exercising the approval this
    // case exists to prove. Fail closed and tell the operator what to change.
    if (approved >= amount) {
      throw new Error(
        `The live wallet already holds an allowance of ${formatUnits(approved, list.decimals)} ${list.currencySymbol} to the collection; this case needs an uncovered allowance. Use a fresh wallet or revoke the allowance before running with E2E_ALLOW_MINT=1.`
      )
    }

    const held = await client.readContract({
      address: collection.address as `0x${string}`,
      abi: balanceAbi,
      functionName: 'balanceOf',
      args: [owner],
    })

    await pinWalletChain(browser, chain.slug)
    await app.open('/mint/tasks')
    await seedVelox(browser, {
      folders: [folder],
      wallets: [wallet],
      connections: [
        testRpc(chain.slug, rpcUrl),
        openseaConnection('deterministic-key'),
      ],
    })
    await app.open('/mint/tasks')

    await screen.getByLabel(URL_LABEL).fill(`https://scatter.art/c/${slug}`)
    await screen
      .getByRole('button', { name: /Select wallets/ })
      .click()
    await screen
      .getByRole('checkbox', { name: `Select all in ${folder.name}` })
      .click()
    await browser.keyboard.press('Escape')
    await screen.getByRole('button', { name: 'Check' }).click()

    // The picker fills once the check reads the collection, and the trigger stays
    // disabled until then. Clicking first would wait out the shorter action timeout.
    await expect(screen.getByLabel('Mint Stage')).toBeEnabled({
      timeout: 180_000,
    })
    await screen.getByLabel('Mint Stage').click()
    await screen.getByRole('option', { name: list.name }).click()

    const row = screen.getByRole('row').filter({ hasText: wallet.address })
    await expect(
      row.getByText(/^(Eligible|Needs approval)$/)
    ).toBeVisible({ timeout: 180_000 })
    // A stage change clears the old verdict, so Start opens only after the new list's
    // probe lands. Clicking earlier would mint the list the check first selected.
    await expect(
      screen.getByRole('button', { name: 'Start Mint' })
    ).toBeEnabled({ timeout: 120_000 })

    // The field prefills with the stage's cap, so a list that caps wallets above one
    // would spend that many tokens and miss the balance assertion below.
    await screen.getByLabel('Quantity').fill('1')

    await pinMintGas(screen)
    await screen.getByRole('button', { name: 'Start Mint' }).click()
    await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({
      timeout: 300_000,
    })

    await screen
      .getByRole('button', { name: `Show execution log for ${wallet.address}` })
      .click()
    const log = screen.getByRole('dialog')
    const text = (await log.textContent()) ?? ''
    const approval = text.match(
      /Approval (0x[0-9a-fA-F]{64}) for (.+?) to (0x[0-9a-fA-F]{40})\./
    )
    const mint = text.match(/Mint (0x[0-9a-fA-F]{64})\./)
    if (approval === null || mint === null) {
      throw new Error(`the run logged no approval and mint pair:\n${text}`)
    }
    // The approval went to the collection the provider resolved, not to an address the
    // test assumed, and it covered the amount the build asked for.
    expect(approval[3]?.toLowerCase()).toBe(collection.address.toLowerCase())
    expect(approval[2]).toBe(amountLabel)

    // Both receipts settled, which is the proof the spender accepted the approval.
    const approvalReceipt = await client.getTransactionReceipt({
      hash: approval[1] as `0x${string}`,
    })
    const mintReceipt = await client.getTransactionReceipt({
      hash: mint[1] as `0x${string}`,
    })
    expect(approvalReceipt.status).toBe('success')
    expect(mintReceipt.status).toBe('success')

    // The wallet now holds one more token of the collection than it did before the run.
    let after = held
    for (let attempt = 0; attempt < 30 && after !== held + 1n; attempt += 1) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 4_000)
      await promise
      after = await client.readContract({
        address: collection.address as `0x${string}`,
        abi: balanceAbi,
        functionName: 'balanceOf',
        args: [owner],
      })
    }
    expect(after).toBe(held + 1n)
  }
)
