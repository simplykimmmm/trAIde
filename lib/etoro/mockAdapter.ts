import { isKillSwitchActive } from "@/lib/paper/database";
import type { IEToroAdapter } from "./adapter";
import { EToroAdapterError, type AccountInfo, type MarketQuote, type OrderRequest, type OrderResult, type Position } from "./types";

const BASE_QUOTES: Record<string, number> = {
  SPY: 520.12,
  QQQ: 445.33,
  AAPL: 182.74,
  MSFT: 414.56,
  GOOGL: 171.9,
  AMZN: 184.2,
  AMD: 156.7,
  COIN: 214.4,
  META: 492.8,
  NVDA: 903.1,
  PLTR: 24.7,
  SOFI: 7.9,
  TSLA: 176.3,
  "BTC/USD": 63750,
  "ETH/USD": 3125,
  "DOGE/USD": 0.15,
  "SOL/USD": 142.5,
};

function jitter(base: number, pct = 0.004): number {
  const wave = Math.sin(Date.now() / 60_000 + base) * pct;
  return Number((base * (1 + wave)).toFixed(base > 1000 ? 2 : 4));
}

export class MockEToroAdapter implements IEToroAdapter {
  async getAccountInfo(): Promise<AccountInfo> {
    const now = new Date().toISOString();
    return {
      accountId: "mock-paper-account",
      currency: "USD",
      balance: 100_000,
      equity: 100_000,
      availableCash: 100_000,
      dailyPnl: 0,
      dailyLoss: 0,
      updatedAt: now,
    };
  }

  async getPositions(): Promise<Position[]> {
    return [
      {
        id: "mock-position-aapl",
        symbol: "AAPL",
        side: "LONG",
        quantity: 5,
        entryPrice: 180.15,
        currentPrice: jitter(BASE_QUOTES.AAPL),
        unrealizedPnl: Number(((jitter(BASE_QUOTES.AAPL) - 180.15) * 5).toFixed(2)),
        stopLoss: 174.5,
        takeProfit: 191,
        openedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    const normalized = symbol.trim().toUpperCase();
    const base = BASE_QUOTES[normalized];

    if (!base) {
      throw new EToroAdapterError("UNSUPPORTED_SYMBOL", `Symbol ${normalized} is not supported by the mock adapter.`);
    }

    const last = jitter(base);
    const spread = Math.max(last * 0.0005, 0.01);
    return {
      symbol: normalized,
      bid: Number((last - spread / 2).toFixed(4)),
      ask: Number((last + spread / 2).toFixed(4)),
      last,
      timestamp: new Date().toISOString(),
      supported: true,
      dayHigh: Number((last * 1.018).toFixed(4)),
      dayLow: Number((last * 0.974).toFixed(4)),
      dayOpen: Number((base * 0.992).toFixed(4)),
      previousClose: base,
      changePct: Number(((last - base) / base).toFixed(4)),
    };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    if (process.env.LIVE_TRADING !== "true") {
      throw new EToroAdapterError("LIVE_TRADING_DISABLED", "Live order placement is disabled. Paper trading remains available.");
    }

    if (await isKillSwitchActive()) {
      throw new EToroAdapterError("KILL_SWITCH_ACTIVE", "Kill switch is active. Order placement is halted.");
    }

    const quote = await this.getQuote(order.symbol);
    return {
      id: `mock-live-${Date.now()}`,
      status: "FILLED",
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      filledPrice: quote.last,
      message: "Mock live fill. Replace mock adapter only after official eToro API integration is confirmed.",
      timestamp: new Date().toISOString(),
      mode: order.mode,
    };
  }
}
