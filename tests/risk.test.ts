import { checkTradeAllowed } from "@/lib/risk/engine";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/config";
import type { RiskCheckParams } from "@/lib/risk/types";

const now = new Date("2026-05-04T12:00:00.000Z");

function baseParams(): RiskCheckParams {
  return {
    killSwitchActive: false,
    tradingMode: "paper",
    liveTradingEnabled: false,
    analysis: {
      symbol: "SPY",
      action: "BUY",
      confidence: 0.8,
      reasoning: "Valid test analysis.",
      invalidation_condition: "Price breaks the stop.",
      suggested_entry: 100,
      suggested_stop_loss: 95,
      suggested_take_profit: 110,
      max_risk_pct: 0.01,
    },
    quote: {
      symbol: "SPY",
      bid: 99.95,
      ask: 100.05,
      last: 100,
      timestamp: now.toISOString(),
      supported: true,
    },
    account: {
      equity: 100_000,
      availableCash: 100_000,
      dailyLoss: 0,
    },
    openPositionsCount: 0,
    candidate: {
      symbol: "SPY",
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      takeProfit: 110,
    },
    config: DEFAULT_RISK_CONFIG,
    now,
  };
}

describe("checkTradeAllowed", () => {
  it("allows a trade that passes all risk checks", () => {
    const result = checkTradeAllowed(baseParams());

    expect(result).toEqual({ allowed: true, positionSize: 200, riskAmount: 1000 });
  });

  it("rejects when the kill switch is active", () => {
    const result = checkTradeAllowed({ ...baseParams(), killSwitchActive: true });

    expect(result).toMatchObject({ allowed: false, reason: "KILL_SWITCH_ACTIVE" });
  });

  it("rejects live trading when LIVE_TRADING is not enabled", () => {
    const result = checkTradeAllowed({ ...baseParams(), tradingMode: "live", liveTradingEnabled: false });

    expect(result).toMatchObject({ allowed: false, reason: "PAPER_MODE_LOCK" });
  });

  it("rejects low-confidence AI analysis", () => {
    const params = baseParams();
    params.analysis.confidence = 0.2;

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "LOW_CONFIDENCE" });
  });

  it("rejects a missing stop-loss", () => {
    const params = baseParams();
    params.candidate.stopLoss = null;

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "MISSING_STOP_LOSS" });
  });

  it("rejects stale market data", () => {
    const params = baseParams();
    params.quote.timestamp = "2026-05-04T11:58:00.000Z";

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "STALE_DATA" });
  });

  it("rejects when max open positions are reached", () => {
    const result = checkTradeAllowed({ ...baseParams(), openPositionsCount: DEFAULT_RISK_CONFIG.maxOpenPositions });

    expect(result).toMatchObject({ allowed: false, reason: "MAX_POSITIONS_REACHED" });
  });

  it("rejects when the daily loss limit is already hit", () => {
    const params = baseParams();
    params.account.dailyLoss = params.account.equity * DEFAULT_RISK_CONFIG.maxDailyLossPct;

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "DAILY_LOSS_LIMIT_HIT" });
  });

  it("rejects when calculated notional exceeds available cash", () => {
    const params = baseParams();
    params.account.equity = 1_000_000;
    params.account.availableCash = 100;

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "INSUFFICIENT_FUNDS" });
  });

  it("rejects when leverage is requested and disabled", () => {
    const params = baseParams();
    params.candidate.requestedLeverage = true;

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "LEVERAGE_NOT_ALLOWED" });
  });

  it("allows paper leverage when explicitly enabled and stop-loss risk remains within account equity", () => {
    const params = baseParams();
    params.account.availableCash = 100;
    params.config = {
      ...DEFAULT_RISK_CONFIG,
      allowLeverage: true,
      paperExposureMultiplier: 5,
      maxDailyLossPct: 1,
      maxAccountRiskPct: 1,
    };

    expect(checkTradeAllowed(params)).toEqual({ allowed: true, positionSize: 1000, riskAmount: 5000 });
  });

  it("rejects leveraged live trades even when leverage is enabled in config", () => {
    const params = baseParams();
    params.tradingMode = "live";
    params.liveTradingEnabled = true;
    params.account.availableCash = 100;
    params.config = {
      ...DEFAULT_RISK_CONFIG,
      allowLeverage: true,
      paperExposureMultiplier: 5,
    };

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "LEVERAGE_NOT_ALLOWED" });
  });

  it("caps aggressive paper risk at remaining account risk", () => {
    const params = baseParams();
    params.config = {
      ...DEFAULT_RISK_CONFIG,
      allowLeverage: true,
      paperExposureMultiplier: 200,
      maxDailyLossPct: 1,
      maxAccountRiskPct: 1,
    };
    params.account.dailyLoss = 99_500;

    expect(checkTradeAllowed(params)).toEqual({ allowed: true, positionSize: 100, riskAmount: 500 });
  });

  it("rejects short selling when disabled", () => {
    const params = baseParams();
    params.analysis.action = "SELL";
    params.candidate.side = "SELL";

    expect(checkTradeAllowed(params)).toMatchObject({ allowed: false, reason: "SHORT_SELLING_NOT_ALLOWED" });
  });
});
