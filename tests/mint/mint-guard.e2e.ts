import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Browser } from '@e2e-dev/web'
import { guardMintResponse } from '../support/mint'

const CONTRACT = '0x00000000000000000000000000000000000000aa'

type GuardRoute = {
  fetch: () => Promise<{ status: number; json: () => Promise<unknown> }>
  fulfill: (response: { status: number; json: unknown }) => Promise<void>
}

test('a pre-open 409 passes through and only the 200 is validated', async () => {
  const captured: {
    handler: ((route: GuardRoute) => Promise<void>) | null
  } = { handler: null }
  const fakeBrowser = {
    route: async (
      _pattern: string | RegExp,
      next: (route: GuardRoute) => Promise<void>,
    ) => {
      captured.handler = next
    },
  } as unknown as Browser

  const matched = await guardMintResponse({
    browser: fakeBrowser,
    contract: CONTRACT,
  })
  const handler = captured.handler
  expect(handler, 'the guard registered a route').not.toBeNull()
  if (handler === null) return

  const fulfilled: { status: number; json: unknown }[] = []
  const route = (status: number, body: unknown): GuardRoute => ({
    fetch: async () => ({ status, json: async () => body }),
    fulfill: async (response) => {
      fulfilled.push(response)
    },
  })

  const rejected = {
    errors: ['Drop is not currently active for minting'],
    code: 'NOT_MINTING',
    // A wrong target and an absurd value: none of it is validated on a 409.
    to: '0x00000000000000000000000000000000000000ff',
    value: '999999999999999999999999',
  }
  await handler(route(409, rejected))
  expect(matched(), 'a pre-open rejection is not the mint under test').toBe(
    false
  )
  expect(fulfilled[0]?.status, 'the 409 is passed to the app').toBe(409)
  expect(fulfilled[0]?.json, 'the rejection body is preserved').toEqual(rejected)

  const accepted = { chain: 'robinhood', to: CONTRACT, value: '0' }
  await handler(route(200, accepted))
  expect(matched(), 'the open-time response is the one under test').toBe(true)
  expect(fulfilled[1]?.status, 'the 200 is passed to the app').toBe(200)
  expect(fulfilled[1]?.json).toEqual(accepted)
})
