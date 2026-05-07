export const DEFAULT_WATCHLIST = ["SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "BTC/USD", "ETH/USD"];

export function getWatchlist(): string[] {
  const raw = process.env.WATCHLIST;
  if (!raw) {
    return DEFAULT_WATCHLIST;
  }

  return raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}
