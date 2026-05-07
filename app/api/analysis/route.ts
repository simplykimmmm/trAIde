import { NextResponse } from "next/server";
import { analyzeSymbol } from "@/lib/ai/analyzeSymbol";
import type { AIAnalysis } from "@/lib/ai/types";
import { getMarketQuote } from "@/lib/market";
import { getWatchlist } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalysisRow = AIAnalysis & { error?: string; quoteTimestamp?: string; lastPrice?: number };

export async function GET() {
  const rows: AnalysisRow[] = [];

  for (const symbol of getWatchlist()) {
    let lastPrice: number | undefined;
    let quoteTimestamp: string | undefined;

    try {
      const quote = await getMarketQuote(symbol);
      lastPrice = quote.last;
      quoteTimestamp = quote.timestamp;
      const analysis = await analyzeSymbol(symbol, quote);
      rows.push({ ...analysis, quoteTimestamp: quote.timestamp, lastPrice: quote.last });
    } catch (error) {
      rows.push({
        symbol,
        action: "HOLD",
        confidence: 0,
        reasoning: "Analysis unavailable; fail-closed.",
        invalidation_condition: "Verify adapter support, market data, and Gemini configuration.",
        suggested_entry: 1,
        suggested_stop_loss: 1,
        suggested_take_profit: 1,
        max_risk_pct: 0,
        quoteTimestamp,
        lastPrice,
        error: error instanceof Error ? error.message : "Unknown analysis error",
      });
    }
  }

  return NextResponse.json({ analyses: rows });
}
