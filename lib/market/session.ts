const CRYPTO_SUFFIX_PATTERN = /\/USD$|USDT$/i;

export type TradingSession = {
  cryptoOnly: boolean;
  label: "REGULAR_ASSET_SCAN" | "WEEKEND_CRYPTO_ONLY";
  reason: string;
};

export function getTradingSession(now = new Date()): TradingSession {
  const cryptoOnly = process.env.WEEKEND_CRYPTO_ONLY !== "false" && isWeekendCryptoWindow(now);

  return {
    cryptoOnly,
    label: cryptoOnly ? "WEEKEND_CRYPTO_ONLY" : "REGULAR_ASSET_SCAN",
    reason: cryptoOnly
      ? "Equity market is outside the normal weekday session window; new scanner ideas are restricted to crypto."
      : "Weekday session allows the configured stock and crypto universe.",
  };
}

export function filterSymbolsForSession(symbols: string[], now = new Date()): string[] {
  const session = getTradingSession(now);
  if (!session.cryptoOnly) {
    return symbols;
  }

  return symbols.filter(isCryptoSymbol);
}

export function isCryptoSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return CRYPTO_SUFFIX_PATTERN.test(normalized) || normalized.startsWith("BINANCE:");
}

function isWeekendCryptoWindow(now: Date): boolean {
  const day = now.getUTCDay();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fridayCloseBufferUtc = 20 * 60;
  const mondayUsOpenApproxUtc = 13 * 60 + 30;

  if (day === 5 && minutes >= fridayCloseBufferUtc) {
    return true;
  }

  if (day === 6 || day === 0) {
    return true;
  }

  return day === 1 && minutes < mondayUsOpenApproxUtc;
}
