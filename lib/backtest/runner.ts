import { mockOhlcvData } from "./mockData";
import { calculateBacktestMetrics } from "./metrics";
import type { BacktestResult, BacktestTrade, OhlcvBar } from "./types";

export const BACKTEST_DISCLAIMER =
  "⚠️ Past performance does not guarantee future results. Backtesting has significant limitations including survivorship bias and look-ahead bias.";

export function runBacktest(bars: OhlcvBar[] = mockOhlcvData, symbol = "SPY", initialEquity = 100_000): BacktestResult {
  const trades: BacktestTrade[] = [];
  const equityCurve: number[] = [initialEquity];
  let equity = initialEquity;

  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1];
    const current = bars[index];

    if (current.close <= previous.close) {
      equityCurve.push(equity);
      continue;
    }

    const riskAmount = equity * 0.005;
    const stop = current.close * 0.98;
    const quantity = riskAmount / Math.max(current.close - stop, 0.01);
    const exitPrice = current.high >= current.close * 1.02 ? current.close * 1.02 : current.close;
    const pnl = (exitPrice - current.close) * quantity;

    equity += pnl;
    equityCurve.push(equity);
    trades.push({
      symbol,
      side: "BUY",
      entryDate: current.date,
      exitDate: current.date,
      entryPrice: round(current.close),
      exitPrice: round(exitPrice),
      quantity: round(quantity),
      pnl: round(pnl),
    });
  }

  return {
    disclaimer: BACKTEST_DISCLAIMER,
    initialEquity,
    finalEquity: round(equity),
    trades,
    metrics: calculateBacktestMetrics(trades, equityCurve, initialEquity, equity),
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
