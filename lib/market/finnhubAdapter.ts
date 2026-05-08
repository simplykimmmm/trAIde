import type { MarketQuote } from "@/lib/etoro/types";

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

const SYMBOL_MAP: Record<string, string> = {
  "BTC/USD": "BINANCE:BTCUSDT",
  "ETH/USD": "BINANCE:ETHUSDT",
  "SOL/USD": "BINANCE:SOLUSDT",
  "DOGE/USD": "BINANCE:DOGEUSDT",
};

type FinnhubQuoteResponse = {
  c?: number;
  d?: number;
  dp?: number;
  h?: number;
  l?: number;
  o?: number;
  pc?: number;
  t?: number;
};

export type FinnhubNewsItem = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

export type FinnhubCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type FinnhubCandleResponse = {
  c?: number[];
  h?: number[];
  l?: number[];
  o?: number[];
  s?: string;
  t?: number[];
  v?: number[];
};

export class FinnhubAdapter {
  private readonly apiKey: string;

  constructor(apiKey = process.env.FINNHUB_API_KEY ?? "") {
    this.apiKey = apiKey;
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    if (!this.apiKey) {
      throw new Error("FINNHUB_API_KEY is not configured.");
    }

    const normalized = symbol.trim().toUpperCase();
    const finnhubSymbol = SYMBOL_MAP[normalized] ?? normalized;
    const params = new URLSearchParams({
      symbol: finnhubSymbol,
      token: this.apiKey,
    });

    const response = await fetch(`${FINNHUB_BASE_URL}/quote?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 429) {
      throw new Error("Finnhub rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(`Finnhub quote request failed with HTTP ${response.status}.`);
    }

    const data = (await response.json()) as FinnhubQuoteResponse;
    if (typeof data.c !== "number" || data.c <= 0) {
      throw new Error(`Finnhub did not return a usable quote for ${normalized}.`);
    }

    const last = data.c;
    const bidAskSpread = Math.max(last * 0.0005, 0.01);
    const timestamp = data.t ? new Date(data.t * 1000).toISOString() : new Date().toISOString();

    return {
      symbol: normalized,
      bid: Number((last - bidAskSpread / 2).toFixed(4)),
      ask: Number((last + bidAskSpread / 2).toFixed(4)),
      last,
      timestamp,
      supported: true,
      dayHigh: data.h,
      dayLow: data.l,
      dayOpen: data.o,
      previousClose: data.pc,
      changePct: data.pc && data.pc > 0 ? Number(((last - data.pc) / data.pc).toFixed(4)) : undefined,
    };
  }

  async getMarketNews(category = "general"): Promise<FinnhubNewsItem[]> {
    if (!this.apiKey) {
      throw new Error("FINNHUB_API_KEY is not configured.");
    }

    const params = new URLSearchParams({ category, token: this.apiKey });
    const response = await fetch(`${FINNHUB_BASE_URL}/news?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 429) {
      throw new Error("Finnhub rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(`Finnhub news request failed with HTTP ${response.status}.`);
    }

    const data = (await response.json()) as unknown;
    return Array.isArray(data) ? data.slice(0, 50) as FinnhubNewsItem[] : [];
  }

  async getRecentCandles(symbol: string, resolution = "1", lookbackMinutes = 30): Promise<FinnhubCandle[]> {
    if (!this.apiKey) {
      throw new Error("FINNHUB_API_KEY is not configured.");
    }

    const normalized = symbol.trim().toUpperCase();
    const finnhubSymbol = SYMBOL_MAP[normalized] ?? normalized;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fromSeconds = nowSeconds - lookbackMinutes * 60;
    const params = new URLSearchParams({
      symbol: finnhubSymbol,
      resolution,
      from: String(fromSeconds),
      to: String(nowSeconds),
      token: this.apiKey,
    });
    const path = finnhubSymbol.includes(":") ? "crypto/candle" : "stock/candle";
    const response = await fetch(`${FINNHUB_BASE_URL}/${path}?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 429) {
      throw new Error("Finnhub rate limit reached.");
    }

    if (!response.ok) {
      throw new Error(`Finnhub candle request failed with HTTP ${response.status}.`);
    }

    const data = (await response.json()) as FinnhubCandleResponse;
    if (data.s !== "ok" || !data.t?.length || !data.c?.length || !data.h?.length || !data.l?.length || !data.o?.length) {
      return [];
    }

    return data.t.map((timestamp, index) => ({
      timestamp: new Date(timestamp * 1000).toISOString(),
      open: data.o?.[index] ?? 0,
      high: data.h?.[index] ?? 0,
      low: data.l?.[index] ?? 0,
      close: data.c?.[index] ?? 0,
      volume: data.v?.[index] ?? 0,
    })).filter((candle) => candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0);
  }
}
