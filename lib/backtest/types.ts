import type { TradeSide } from "@/lib/etoro/types";

export type OhlcvBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BacktestTrade = {
  symbol: string;
  side: TradeSide;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
};

export type BacktestMetrics = {
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  averageWin: number;
  averageLoss: number;
  totalTrades: number;
  profitFactor: number;
};

export type BacktestResult = {
  disclaimer: string;
  initialEquity: number;
  finalEquity: number;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
};
