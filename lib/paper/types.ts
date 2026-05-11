import type { TradeSide } from "@/lib/etoro/types";

export type PaperTradeStatus = "OPEN" | "CLOSED_TP" | "CLOSED_QUICK_TP" | "CLOSED_SL" | "CLOSED_MANUAL" | "REJECTED";

export type PaperTrade = {
  id: number;
  timestamp: string;
  symbol: string;
  action: TradeSide | "HOLD" | "REJECT";
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  status: PaperTradeStatus;
  close_price: number | null;
  pnl: number | null;
  fee_approx: number;
  rejection_reason: string | null;
  ai_confidence: number | null;
  notes: string | null;
};

export type PaperAccount = {
  id: number;
  balance: number;
  equity: number;
  daily_loss: number;
  last_reset_date: string;
};

export type ExecutePaperTradeInput = {
  symbol: string;
  action: TradeSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  aiConfidence: number;
  notes: string;
};

export type RejectedTradeInput = {
  symbol: string;
  action: TradeSide | "HOLD";
  entryPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  rejectionReason: string;
  aiConfidence?: number | null;
  notes: string;
};
