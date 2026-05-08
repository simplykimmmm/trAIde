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

export function getRiskConfig(): RiskConfig {
  return {
    maxRiskPerTradePct: readNumber("MAX_RISK_PER_TRADE_PCT", DEFAULT_RISK_CONFIG.maxRiskPerTradePct),
    maxDailyLossPct: readNumber("MAX_DAILY_LOSS_PCT", DEFAULT_RISK_CONFIG.maxDailyLossPct),
    maxOpenPositions: readNumber("MAX_OPEN_POSITIONS", DEFAULT_RISK_CONFIG.maxOpenPositions),
    minAIConfidence: readNumber("MIN_AI_CONFIDENCE", DEFAULT_RISK_CONFIG.minAIConfidence),
    allowLeverage: process.env.ALLOW_LEVERAGE === "true",
    allowShortSelling: process.env.ALLOW_SHORT_SELLING === "true",
    paperExposureMultiplier: clamp(readNumber("PAPER_EXPOSURE_MULTIPLIER", DEFAULT_RISK_CONFIG.paperExposureMultiplier), 1, 20),
    maxAccountRiskPct: clamp(readNumber("MAX_ACCOUNT_RISK_PCT", DEFAULT_RISK_CONFIG.maxAccountRiskPct), 0.01, 1),
    dataStaleThresholdMs: readNumber("DATA_STALE_THRESHOLD_MS", DEFAULT_RISK_CONFIG.dataStaleThresholdMs),
  };
}

export function getEffectivePaperRiskConfig(): RiskConfig {
  const base = getRiskConfig();
  const botSettings = getBotSettings();

  return {
    ...base,
    maxRiskPerTradePct: Math.min(base.maxRiskPerTradePct * botSettings.riskMultiplier, 0.05),
    paperExposureMultiplier: Math.min(base.paperExposureMultiplier * botSettings.speedMultiplier, 20),
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
