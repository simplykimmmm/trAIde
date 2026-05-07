export type AIAction = "BUY" | "SELL" | "HOLD";

export type AIAnalysis = {
  symbol: string;
  action: AIAction;
  confidence: number;
  reasoning: string;
  invalidation_condition: string;
  suggested_entry: number;
  suggested_stop_loss: number;
  suggested_take_profit: number;
  max_risk_pct: number;
};
