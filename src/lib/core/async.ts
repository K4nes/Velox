// Bounded concurrency for the reads that fan out over wallets or tokens. The cursor loop
// lives here once, so a fix to how it schedules work lands in every caller.

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await run(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )
}

// All or nothing: the first rejection ends the call.
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  await eachLimited(items, limit, async (item, index) => {
    results[index] = await run(item)
  })
  return results
}

// Each item either answers or fails, and the caller decides what a failure means. A
// balance read needs this: one rate-limited public RPC must not wipe the answers that did
// come back.
export async function mapLimitSettled<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<{
  resolved: { item: T; value: R }[]
  failed: T[]
  firstError: unknown
}> {
  const resolved: { item: T; value: R }[] = []
  const failed: T[] = []
  let firstError: unknown = null

  await eachLimited(items, limit, async (item) => {
    try {
      resolved.push({ item, value: await run(item) })
    } catch (error) {
      failed.push(item)
      if (firstError === null) firstError = error
    }
  })

  return { resolved, failed, firstError }
}
