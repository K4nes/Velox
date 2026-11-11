// How long a CoinMarketCap quote stays good. The server reuses its last answer
// inside this window instead of billing another call, and the card trusts a
// quote for the same window. Both processes read this one value, so the cache
// hit in `server/price.ts` and the check in `src/pages/pnl/card-state.ts` cannot
// disagree about a quote either of them still has.
export const QUOTE_WINDOW_MS = 60_000
