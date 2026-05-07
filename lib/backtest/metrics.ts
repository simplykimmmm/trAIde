import type { BacktestMetrics, BacktestTrade } from "./types";

export function calculateBacktestMetrics(trades: BacktestTrade[], equityCurve: number[], initialEquity: number, finalEquity: number): BacktestMetrics {
  const winners = trades.filter((trade) => trade.pnl > 0);
  const losers = trades.filter((trade) => trade.pnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.pnl, 0));

  return {
    totalReturnPct: pct((finalEquity - initialEquity) / initialEquity),
    maxDrawdownPct: calculateMaxDrawdownPct(equityCurve),
    winRatePct: trades.length ? pct(winners.length / trades.length) : 0,
    averageWin: winners.length ? round(grossProfit / winners.length) : 0,
    averageLoss: losers.length ? round(grossLoss / losers.length) : 0,
    totalTrades: trades.length,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : round(grossProfit / grossLoss),
  };
}

function calculateMaxDrawdownPct(equityCurve: number[]): number {
  let peak = equityCurve[0] ?? 0;
  let maxDrawdown = 0;

  for (const equity of equityCurve) {
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  return pct(maxDrawdown);
}

function pct(value: number): number {
  return round(value * 100);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
