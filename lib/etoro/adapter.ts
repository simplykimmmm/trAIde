import type { AccountInfo, MarketQuote, OrderRequest, OrderResult, Position } from "./types";

export interface IEToroAdapter {
  getAccountInfo(): Promise<AccountInfo>;
  getPositions(): Promise<Position[]>;
  getQuote(symbol: string): Promise<MarketQuote>;
  placeOrder(order: OrderRequest): Promise<OrderResult>;
}
