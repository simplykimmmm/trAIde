import type { AIAnalysis } from "@/lib/ai/types";
import type { MarketQuote } from "@/lib/etoro/types";
import { FinnhubAdapter, type FinnhubNewsItem } from "@/lib/market/finnhubAdapter";
import { getMarketQuote } from "@/lib/market";
import { getWatchlist } from "@/lib/watchlist";
import type { OpportunityCandidate, OpportunitySource } from "./types";

const DEFAULT_UNIVERSE = [
  "SPY",
  "QQQ",
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "AMD",
  "COIN",
  "META",
  "NVDA",
  "PLTR",
  "SOFI",
  "TSLA",
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "DOGE/USD",
];

const NEWS_SYMBOL_PATTERN = /^[A-Z][A-Z0-9.:-]{0,11}$/;

export async function scanOpportunities(limit = getOpportunityLimit()): Promise<OpportunityCandidate[]> {
  const finnhub = new FinnhubAdapter();
  if (!finnhub.enabled) {
    return buildMockOpportunities(limit);
  }

  const newsBySymbol = await safeLoadNews(finnhub);
  const universe = uniqueSymbols([...newsBySymbol.keys(), ...getOpportunityUniverse(), ...getWatchlist()]).slice(0, getMaxScanSymbols());
  const candidates: OpportunityCandidate[] = [];

  for (const symbol of universe) {
    try {
      const quote = await getMarketQuote(symbol);
      const candles = finnhub.enabled && isHighInterestQuote(quote, newsBySymbol.has(symbol))
        ? await safeLoadCandles(finnhub, symbol)
        : [];
      const candidate = buildOpportunity(symbol, quote, newsBySymbol.get(symbol), candles);

      if (candidate.score >= getMinimumOpportunityScore()) {
        candidates.push(candidate);
      }
    } catch {
      // Unsupported symbols are skipped. The dashboard stays fail-closed instead of inventing data.
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function buildOpportunityAnalysis(candidate: OpportunityCandidate): AIAnalysis {
  const last = candidate.lastPrice;
  const stopPct = clamp(candidate.volatilityPct / 3, 0.003, 0.03);
  const takeProfitPct = clamp(candidate.volatilityPct / 2, 0.004, 0.04);
  const confidence = clamp(0.58 + candidate.score / 100, 0.55, 0.84);
  const action = candidate.source === "DROP_BOUNCE" || candidate.source === "NEWS" || candidate.source === "VOLATILITY" ? "BUY" : "HOLD";

  return {
    symbol: candidate.symbol,
    action,
    confidence: Number(confidence.toFixed(2)),
    reasoning: trimReason(`${candidate.source}: ${candidate.reason}`),
    invalidation_condition: "Price breaks the scanner stop or data/news becomes stale.",
    suggested_entry: Number(last.toFixed(4)),
    suggested_stop_loss: Number((last * (1 - stopPct)).toFixed(4)),
    suggested_take_profit: Number((last * (1 + takeProfitPct)).toFixed(4)),
    max_risk_pct: 0.01,
  };
}

function buildOpportunity(symbol: string, quote: MarketQuote, news: FinnhubNewsItem | undefined, candles: Array<{ close: number; high: number; low: number }>): OpportunityCandidate {
  const priceChangePct = quote.changePct ?? calculateChangePct(quote.last, quote.previousClose);
  const volatilityPct = calculateVolatilityPct(quote);
  const recentMovePct = calculateRecentMovePct(candles);
  const source = chooseSource(priceChangePct, volatilityPct, recentMovePct, Boolean(news));
  const newsBoost = news ? 18 : 0;
  const dropBounceBoost = source === "DROP_BOUNCE" ? 20 : 0;
  const volatilityScore = clamp(volatilityPct * 1200, 0, 36);
  const moveScore = clamp(Math.abs(priceChangePct) * 900, 0, 28);
  const recentScore = clamp(Math.abs(recentMovePct ?? 0) * 1500, 0, 18);
  const score = Math.round(clamp(newsBoost + dropBounceBoost + volatilityScore + moveScore + recentScore, 0, 100));

  return {
    symbol,
    source,
    score,
    lastPrice: quote.last,
    priceChangePct,
    volatilityPct,
    recentMovePct,
    headline: news?.headline,
    reason: buildReason(source, priceChangePct, volatilityPct, recentMovePct, news),
    generatedAt: new Date().toISOString(),
  };
}

async function safeLoadNews(finnhub: FinnhubAdapter): Promise<Map<string, FinnhubNewsItem>> {
  try {
    const news = await finnhub.getMarketNews("general");
    const bySymbol = new Map<string, FinnhubNewsItem>();

    for (const item of news) {
      for (const symbol of parseRelatedSymbols(item.related)) {
        if (!bySymbol.has(symbol)) {
          bySymbol.set(symbol, item);
        }
      }
    }

    return bySymbol;
  } catch {
    return new Map();
  }
}

async function safeLoadCandles(finnhub: FinnhubAdapter, symbol: string) {
  try {
    return await finnhub.getRecentCandles(symbol, "1", 30);
  } catch {
    return [];
  }
}

function parseRelatedSymbols(related: string | undefined): string[] {
  if (!related) {
    return [];
  }

  return related
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => NEWS_SYMBOL_PATTERN.test(symbol))
    .slice(0, 8);
}

function calculateChangePct(last: number, previousClose: number | undefined): number {
  if (!previousClose || previousClose <= 0) {
    return 0;
  }

  return Number(((last - previousClose) / previousClose).toFixed(4));
}

function calculateVolatilityPct(quote: MarketQuote): number {
  if (quote.dayHigh && quote.dayLow && quote.last > 0 && quote.dayHigh > quote.dayLow) {
    return Number(((quote.dayHigh - quote.dayLow) / quote.last).toFixed(4));
  }

  return Math.abs(quote.changePct ?? 0);
}

function calculateRecentMovePct(candles: Array<{ close: number }>): number | undefined {
  if (candles.length < 2) {
    return undefined;
  }

  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  if (first <= 0 || last <= 0) {
    return undefined;
  }

  return Number(((last - first) / first).toFixed(4));
}

function chooseSource(priceChangePct: number, volatilityPct: number, recentMovePct: number | undefined, hasNews: boolean): OpportunitySource {
  if ((priceChangePct <= -0.01 || (recentMovePct ?? 0) <= -0.006) && volatilityPct >= 0.012) {
    return "DROP_BOUNCE";
  }

  if (hasNews) {
    return "NEWS";
  }

  if (volatilityPct >= 0.012 || Math.abs(recentMovePct ?? 0) >= 0.006) {
    return "VOLATILITY";
  }

  return "MOCK";
}

function buildReason(source: OpportunitySource, priceChangePct: number, volatilityPct: number, recentMovePct: number | undefined, news: FinnhubNewsItem | undefined): string {
  const change = `${(priceChangePct * 100).toFixed(2)}%`;
  const vol = `${(volatilityPct * 100).toFixed(2)}%`;
  const recent = typeof recentMovePct === "number" ? `, recent ${(recentMovePct * 100).toFixed(2)}%` : "";

  if (source === "DROP_BOUNCE") {
    return `Fast drop-bounce watch: day change ${change}, intraday range ${vol}${recent}.`;
  }

  if (source === "NEWS") {
    return `News-linked symbol with day change ${change}, range ${vol}. ${news?.headline ?? ""}`.trim();
  }

  if (source === "VOLATILITY") {
    return `High-volatility watch: day change ${change}, intraday range ${vol}${recent}.`;
  }

  return `Mock scanner fallback: day change ${change}, range ${vol}.`;
}

function isHighInterestQuote(quote: MarketQuote, hasNews: boolean): boolean {
  return hasNews || Math.abs(quote.changePct ?? 0) >= 0.006 || calculateVolatilityPct(quote) >= 0.012;
}

function getOpportunityUniverse(): string[] {
  const raw = process.env.OPPORTUNITY_UNIVERSE;
  if (!raw) {
    return DEFAULT_UNIVERSE;
  }

  return raw.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
}

function getOpportunityLimit(): number {
  return clampInteger(Number(process.env.OPPORTUNITY_LIMIT ?? 8), 1, 20);
}

function getMaxScanSymbols(): number {
  return clampInteger(Number(process.env.OPPORTUNITY_MAX_SCAN_SYMBOLS ?? 18), 5, 40);
}

function getMinimumOpportunityScore(): number {
  return clamp(Number(process.env.OPPORTUNITY_MIN_SCORE ?? 22), 0, 100);
}

function uniqueSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function buildMockOpportunities(limit: number): OpportunityCandidate[] {
  const now = new Date().toISOString();
  return DEFAULT_UNIVERSE.slice(0, limit).map((symbol, index) => ({
    symbol,
    source: "MOCK",
    score: 30 - index,
    lastPrice: 100 + index * 10,
    priceChangePct: -0.012 + index * 0.001,
    volatilityPct: 0.02,
    reason: "Mock opportunity because FINNHUB_API_KEY is missing.",
    generatedAt: now,
  }));
}

function trimReason(reason: string): string {
  return reason.length > 200 ? `${reason.slice(0, 197)}...` : reason;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
