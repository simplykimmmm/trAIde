import { filterSymbolsForSession, getTradingSession, isCryptoSymbol } from "@/lib/market/session";

describe("market session guard", () => {
  afterEach(() => {
    delete process.env.WEEKEND_CRYPTO_ONLY;
  });

  it("restricts new ideas to crypto after Friday equity close", () => {
    const session = getTradingSession(new Date("2026-05-08T20:01:00.000Z"));

    expect(session.cryptoOnly).toBe(true);
    expect(filterSymbolsForSession(["AAPL", "BTC/USD", "ETH/USD"], new Date("2026-05-08T20:01:00.000Z"))).toEqual(["BTC/USD", "ETH/USD"]);
  });

  it("allows the configured universe during weekday market window", () => {
    const session = getTradingSession(new Date("2026-05-08T19:59:00.000Z"));

    expect(session.cryptoOnly).toBe(false);
    expect(filterSymbolsForSession(["AAPL", "BTC/USD"], new Date("2026-05-08T19:59:00.000Z"))).toEqual(["AAPL", "BTC/USD"]);
  });

  it("recognizes supported crypto symbol formats", () => {
    expect(isCryptoSymbol("BTC/USD")).toBe(true);
    expect(isCryptoSymbol("BINANCE:ETHUSDT")).toBe(true);
    expect(isCryptoSymbol("COIN")).toBe(false);
  });
});
