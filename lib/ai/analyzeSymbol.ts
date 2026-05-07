import type { MarketQuote } from "@/lib/etoro/types";
import { aiAnalysisSchema } from "./schema";
import type { AIAnalysis } from "./types";
import { callGemini, waitForGeminiRateLimit } from "./geminiClient";

export function buildAnalysisPrompt(symbol: string, marketData: MarketQuote): string {
  return `You are a cautious financial analysis assistant. Analyze the following market data for ${symbol} and return ONLY a valid JSON object matching this schema. Do not add commentary outside the JSON.

Market data:
${JSON.stringify(marketData, null, 2)}

Return JSON with these exact fields:
{
  "symbol": string,
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": number (0.0 to 1.0),
  "reasoning": string (max 180 chars),
  "invalidation_condition": string,
  "suggested_entry": number,
  "suggested_stop_loss": number,
  "suggested_take_profit": number,
  "max_risk_pct": number (0.0 to 1.0)
}

Rules:
- Return only JSON, no markdown.
- All numeric price fields must be positive finite numbers.
- For HOLD, set suggested_entry to the current last price, suggested_stop_loss below it, and suggested_take_profit above it.
- Keep max_risk_pct at or below 0.05.
- Do not recommend leverage or short selling.`;
}

export async function analyzeSymbol(symbol: string, marketData: MarketQuote): Promise<AIAnalysis> {
  const prompt = buildAnalysisPrompt(symbol, marketData);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const raw = hasGeminiKey ? await callGemini(prompt) : buildFallbackAnalysis(symbol, marketData);

  try {
    const parsedJson = JSON.parse(stripCodeFence(raw));
    const analysis = aiAnalysisSchema.parse(parsedJson);
    if (hasGeminiKey) {
      await waitForGeminiRateLimit();
    }
    return analysis;
  } catch (error) {
    console.error("Invalid Gemini response:", sanitizeForLog(raw));
    throw error;
  }
}

function buildFallbackAnalysis(symbol: string, marketData: MarketQuote): string {
  const last = marketData.last;
  return JSON.stringify({
    symbol,
    action: "HOLD",
    confidence: 0.5,
    reasoning: "Gemini key missing; fail-closed mock analysis returns HOLD only.",
    invalidation_condition: "Configure GEMINI_API_KEY and verify fresh market data.",
    suggested_entry: last,
    suggested_stop_loss: Number((last * 0.98).toFixed(4)),
    suggested_take_profit: Number((last * 1.03).toFixed(4)),
    max_risk_pct: 0.005,
  });
}

function stripCodeFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function sanitizeForLog(raw: string): string {
  return raw.replace(/(api[_-]?key|account[_-]?id)["':=\s]+[A-Za-z0-9._-]+/gi, "$1=[redacted]");
}
