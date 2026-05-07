import { getEToroAdapter } from "@/lib/etoro";
import type { MarketQuote } from "@/lib/etoro/types";
import { FinnhubAdapter } from "./finnhubAdapter";

export type MarketDataProvider = "finnhub" | "mock-etoro";

export function getMarketDataProvider(): MarketDataProvider {
  return process.env.FINNHUB_API_KEY ? "finnhub" : "mock-etoro";
}

export async function getMarketQuote(symbol: string): Promise<MarketQuote> {
  const finnhub = new FinnhubAdapter();

  if (finnhub.enabled) {
    return finnhub.getQuote(symbol);
  }

  return getEToroAdapter().getQuote(symbol);
}
