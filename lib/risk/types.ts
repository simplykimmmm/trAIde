import type { AIAnalysis } from "@/lib/ai/types";
import type { MarketQuote, TradeSide, TradingMode } from "@/lib/etoro/types";

export type RejectionReason =
  | "KILL_SWITCH_ACTIVE"
  | "PAPER_MODE_LOCK"
  | "LOW_CONFIDENCE"
  | "MISSING_STOP_LOSS"
  | "STALE_DATA"
  | "MAX_POSITIONS_REACHED"
  | "DAILY_LOSS_LIMIT_HIT"
  | "INSUFFICIENT_FUNDS"
  | "LEVERAGE_NOT_ALLOWED"
  | "ACCOUNT_RISK_LIMIT_HIT"
  | "SHORT_SELLING_NOT_ALLOWED";

export type RiskConfig = {
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  minAIConfidence: number;
  allowLeverage: boolean;
  allowShortSelling: boolean;
  paperExposureMultiplier: number;
  maxAccountRiskPct: number;
  dataStaleThresholdMs: number;
};

export type RiskAccountSnapshot = {
  equity: number;
  availableCash: number;
  dailyLoss: number;
};

export type TradeCandidate = {
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  stopLoss?: number | null;
  takeProfit: number;
  requestedLeverage?: boolean;
};

export type RiskCheckParams = {
  killSwitchActive: boolean;
  tradingMode: TradingMode;
  liveTradingEnabled: boolean;
  analysis: AIAnalysis;
  quote: MarketQuote;
  account: RiskAccountSnapshot;
  openPositionsCount: number;
  candidate: TradeCandidate;
  config: RiskConfig;
  now?: Date;
};

export type RiskCheckResult =
  | { allowed: true; positionSize: number; riskAmount: number }
  | { allowed: false; reason: RejectionReason; detail: string };
