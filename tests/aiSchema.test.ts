import { aiAnalysisSchema } from "@/lib/ai/schema";

const validAnalysis = {
  symbol: "SPY",
  action: "BUY",
  confidence: 0.78,
  reasoning: "Momentum is constructive but risk remains capped.",
  invalidation_condition: "Close below the suggested stop-loss.",
  suggested_entry: 100,
  suggested_stop_loss: 97,
  suggested_take_profit: 106,
  max_risk_pct: 0.01,
};

describe("aiAnalysisSchema", () => {
  it("accepts a valid AI analysis payload", () => {
    expect(aiAnalysisSchema.parse(validAnalysis)).toEqual(validAnalysis);
  });

  it("rejects confidence outside the 0 to 1 range", () => {
    expect(() => aiAnalysisSchema.parse({ ...validAnalysis, confidence: 1.2 })).toThrow();
  });

  it("rejects max_risk_pct above 5 percent", () => {
    expect(() => aiAnalysisSchema.parse({ ...validAnalysis, max_risk_pct: 0.08 })).toThrow();
  });

  it("rejects overlong reasoning", () => {
    expect(() => aiAnalysisSchema.parse({ ...validAnalysis, reasoning: "x".repeat(201) })).toThrow();
  });

  it("rejects unexpected fields", () => {
    expect(() => aiAnalysisSchema.parse({ ...validAnalysis, apiKey: "do-not-log" })).toThrow();
  });
});
