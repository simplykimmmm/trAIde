import type { SentimentLabel, SentimentSignal } from "./sentiment";

export type OpportunitySource = "NEWS" | "SENTIMENT" | "VOLATILITY" | "DROP_BOUNCE" | "MOCK";

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
  sentimentScore?: number;
  sentimentLabel?: SentimentLabel;
  sentimentSignal?: SentimentSignal;
  sentimentReason?: string;
  cryptoOnlySession?: boolean;
  headline?: string;
  reason: string;
  generatedAt: string;
};
