import type { RiskConfig } from "./types";
import { getBotSettings } from "@/lib/paper/database";

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxRiskPerTradePct: 0.01,
  maxDailyLossPct: 0.03,
  maxOpenPositions: 3,
  minAIConfidence: 0.65,
  allowLeverage: false,
  allowShortSelling: false,
  paperExposureMultiplier: 1,
  maxAccountRiskPct: 1,
  dataStaleThresholdMs: 60_000,
};
const MAX_EFFECTIVE_PAPER_RISK_PER_TRADE_PCT = 0.5;
const MAX_PAPER_EXPOSURE_MULTIPLIER = 5;

export function getRiskConfig(): RiskConfig {
  return {
    maxRiskPerTradePct: readPercent("MAX_RISK_PER_TRADE_PCT", DEFAULT_RISK_CONFIG.maxRiskPerTradePct),
    maxDailyLossPct: readPercent("MAX_DAILY_LOSS_PCT", DEFAULT_RISK_CONFIG.maxDailyLossPct),
    maxOpenPositions: readNumber("MAX_OPEN_POSITIONS", DEFAULT_RISK_CONFIG.maxOpenPositions),
    minAIConfidence: readPercent("MIN_AI_CONFIDENCE", DEFAULT_RISK_CONFIG.minAIConfidence),
    allowLeverage: process.env.ALLOW_LEVERAGE === "true",
    allowShortSelling: process.env.ALLOW_SHORT_SELLING === "true",
    paperExposureMultiplier: clamp(readNumber("PAPER_EXPOSURE_MULTIPLIER", DEFAULT_RISK_CONFIG.paperExposureMultiplier), 1, MAX_PAPER_EXPOSURE_MULTIPLIER),
    maxAccountRiskPct: clamp(readPercent("MAX_ACCOUNT_RISK_PCT", DEFAULT_RISK_CONFIG.maxAccountRiskPct), 0.01, 1),
    dataStaleThresholdMs: readNumber("DATA_STALE_THRESHOLD_MS", DEFAULT_RISK_CONFIG.dataStaleThresholdMs),
  };
}

export async function getEffectivePaperRiskConfig(): Promise<RiskConfig> {
  const base = getRiskConfig();
  const botSettings = await getBotSettings();

  return {
    ...base,
    maxRiskPerTradePct: Math.min(base.maxRiskPerTradePct * botSettings.riskMultiplier, MAX_EFFECTIVE_PAPER_RISK_PER_TRADE_PCT),
    paperExposureMultiplier: Math.min(base.paperExposureMultiplier, botSettings.speedMultiplier, MAX_PAPER_EXPOSURE_MULTIPLIER),
  };
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readPercent(key: string, fallback: number): number {
  const value = readNumber(key, fallback);

  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value > 1 ? value / 100 : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
