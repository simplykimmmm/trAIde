import type { MarketQuote } from "@/lib/etoro/types";

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

const SYMBOL_MAP: Record<string, string> = {
  "BTC/USD": "BINANCE:BTCUSDT",
  "ETH/USD": "BINANCE:ETHUSDT",
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
    };
  }
}
