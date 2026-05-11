import type { RejectionReason, RiskCheckParams, RiskCheckResult } from "./types";

export function checkTradeAllowed(params: RiskCheckParams): RiskCheckResult {
  const { account, analysis, candidate, config, quote } = params;
  const now = params.now ?? new Date();

  if (params.killSwitchActive) {
    return reject("KILL_SWITCH_ACTIVE", "Kill switch is active.");
  }

  if (params.tradingMode === "live" && !params.liveTradingEnabled) {
    return reject("PAPER_MODE_LOCK", "Live trading was requested while LIVE_TRADING is not enabled.");
  }

  if (analysis.confidence < config.minAIConfidence) {
    return reject("LOW_CONFIDENCE", `AI confidence ${analysis.confidence} is below ${config.minAIConfidence}.`);
  }

  if (typeof candidate.stopLoss !== "number" || !Number.isFinite(candidate.stopLoss) || candidate.stopLoss <= 0) {
    return reject("MISSING_STOP_LOSS", "A valid stop-loss is required before any trade can be considered.");
  }

  const quoteAgeMs = now.getTime() - new Date(quote.timestamp).getTime();
  if (!Number.isFinite(quoteAgeMs) || quoteAgeMs > config.dataStaleThresholdMs) {
    return reject("STALE_DATA", `Market quote is stale by ${Math.max(quoteAgeMs, 0)}ms.`);
  }

  if (params.openPositionsCount >= config.maxOpenPositions) {
    return reject("MAX_POSITIONS_REACHED", `Open positions ${params.openPositionsCount} reached limit ${config.maxOpenPositions}.`);
  }

  if (!Number.isFinite(account.equity) || account.equity <= 0) {
    return reject("ACCOUNT_RISK_LIMIT_HIT", "Account equity is depleted or unavailable.");
  }

  if (!Number.isFinite(account.availableCash) || account.availableCash <= 0) {
    return reject("ACCOUNT_RISK_LIMIT_HIT", "Available cash is depleted or unavailable.");
  }

  const dailyLossLimit = account.equity * config.maxDailyLossPct;
  if (account.dailyLoss >= dailyLossLimit) {
    return reject("DAILY_LOSS_LIMIT_HIT", `Daily loss ${account.dailyLoss} reached limit ${dailyLossLimit}.`);
  }

  if (candidate.side === "SELL" && !config.allowShortSelling) {
    return reject("SHORT_SELLING_NOT_ALLOWED", "Short selling is disabled by risk configuration.");
  }

  const stopDistance = Math.abs(candidate.entryPrice - candidate.stopLoss);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
    return reject("MISSING_STOP_LOSS", "Stop-loss must be different from entry price.");
  }

  const riskPct = Math.min(config.maxRiskPerTradePct, analysis.max_risk_pct);
  const requestedRiskAmount = account.equity * riskPct * (params.tradingMode === "paper" ? config.paperExposureMultiplier : 1);
  const remainingAccountRisk = Math.max(account.equity * config.maxAccountRiskPct - account.dailyLoss, 0);
  const remainingDailyRisk = Math.max(dailyLossLimit - account.dailyLoss, 0);
  const riskAmount = Math.min(requestedRiskAmount, remainingAccountRisk, remainingDailyRisk);

  if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
    return reject("ACCOUNT_RISK_LIMIT_HIT", "No account risk capacity remains for this trade.");
  }

  const positionSize = riskAmount / stopDistance;
  const notional = positionSize * candidate.entryPrice;
  const leverageRequested = candidate.requestedLeverage || notional > account.availableCash || notional > account.equity;

  if (notional > account.availableCash && !config.allowLeverage) {
    return reject("INSUFFICIENT_FUNDS", `Required notional ${notional.toFixed(2)} exceeds available cash ${account.availableCash.toFixed(2)}.`);
  }

  if (leverageRequested && (!config.allowLeverage || params.tradingMode !== "paper")) {
    return reject("LEVERAGE_NOT_ALLOWED", "Calculated trade requires leverage, which is only allowed in paper mode when enabled.");
  }

  return {
    allowed: true,
    positionSize: Number(positionSize.toFixed(6)),
    riskAmount: Number(riskAmount.toFixed(2)),
  };
}

function reject(reason: RejectionReason, detail: string): RiskCheckResult {
  return { allowed: false, reason, detail };
}
