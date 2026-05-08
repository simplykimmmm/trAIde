export type OpportunitySource = "NEWS" | "VOLATILITY" | "DROP_BOUNCE" | "MOCK";

export type OpportunityCandidate = {
  symbol: string;
  source: OpportunitySource;
  score: number;
  lastPrice: number;
  priceChangePct: number;
  volatilityPct: number;
  recentMovePct?: number;
  headline?: string;
  reason: string;
  generatedAt: string;
};
