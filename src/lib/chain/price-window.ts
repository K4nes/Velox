// How long a CoinMarketCap quote stays good. The dev server reuses its last
// answer inside this window instead of billing another call. The in-app command
// keeps the same value in `src-tauri/src/price.rs`, because Rust cannot import
// this module.
export const QUOTE_WINDOW_MS = 60_000
