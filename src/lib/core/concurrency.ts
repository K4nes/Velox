// How many calls this app keeps in flight against one endpoint. One table, so retuning is
// one edit, and no module quietly keeps its own idea of the same policy.

// One wallet at a time, because each step signs and the next one reads its result.
export const WALLET_CONCURRENCY = 2

// Waiting for a submitted transaction or a bridged intent to settle.
export const SETTLE_CONCURRENCY = 4

// Reading chain history per trade group, and other read fan-outs with no signature.
export const FLOW_CONCURRENCY = 4

// Public RPC balance reads, which tolerate more in flight than a signed flow.
export const BALANCE_CONCURRENCY = 5
