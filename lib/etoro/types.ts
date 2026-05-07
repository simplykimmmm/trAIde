export type TradeSide = "BUY" | "SELL";
export type PositionSide = "LONG" | "SHORT";
export type TradingMode = "paper" | "live";

export type AccountInfo = {
  accountId: string;
  currency: string;
  balance: number;
  equity: number;
  availableCash: number;
  dailyPnl: number;
  dailyLoss: number;
  updatedAt: string;
};

export type Position = {
  id: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: string;
};

export type MarketQuote = {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: string;
  supported: boolean;
};

export type OrderRequest = {
  symbol: string;
  side: TradeSide;
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  mode: TradingMode;
  limitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  clientRequestId?: string;
};

export type OrderResult = {
  id: string;
  status: "ACCEPTED" | "REJECTED" | "FILLED" | "PENDING";
  symbol: string;
  side: TradeSide;
  quantity: number;
  filledPrice?: number;
  message: string;
  timestamp: string;
  mode: TradingMode;
};

export class EToroAdapterError extends Error {
  constructor(
    public readonly code:
      | "LIVE_TRADING_DISABLED"
      | "KILL_SWITCH_ACTIVE"
      | "UNSUPPORTED_SYMBOL"
      | "CONFIGURATION_ERROR"
      | "UNIMPLEMENTED"
      | "UPSTREAM_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "EToroAdapterError";
  }
}
