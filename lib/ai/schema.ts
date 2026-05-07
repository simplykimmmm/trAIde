import { z } from "zod";

export const aiAnalysisSchema = z
  .object({
    symbol: z.string().min(1),
    action: z.enum(["BUY", "SELL", "HOLD"]),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1).max(200),
    invalidation_condition: z.string().min(1).max(300),
    suggested_entry: z.number().finite().positive(),
    suggested_stop_loss: z.number().finite().positive(),
    suggested_take_profit: z.number().finite().positive(),
    max_risk_pct: z.number().min(0).max(0.05),
  })
  .strict();

export type AIAnalysisSchema = z.infer<typeof aiAnalysisSchema>;
