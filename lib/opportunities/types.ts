export type OpportunitySource = "NEWS" | "VOLATILITY" | "DROP_BOUNCE" | "MOCK";

export type OpportunityCandidate = {
  symbol: string;
  source: OpportunitySource;
  score: number;
  lastPrice: number;
  priceChangePct: number;
  volatilityPct: number;
  recentMovePct?: number;
  rsi2?: number;
  rsi14?: number;
  atrPct?: number;
  trendPct?: number;
  regime?: string;
  cryptoOnlySession?: boolean;
  headline?: string;
  reason: string;
  generatedAt: string;
};
