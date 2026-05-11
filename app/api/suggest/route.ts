import { NextRequest, NextResponse } from "next/server";
import { analyzeSymbol } from "@/lib/ai/analyzeSymbol";
import type { TradeSide, TradingMode } from "@/lib/etoro/types";
import { getMarketQuote } from "@/lib/market";
import { filterSymbolsForSession, getTradingSession } from "@/lib/market/session";
import { buildOpportunityAnalysis, scanOpportunities } from "@/lib/opportunities/scanner";
import { getPaperAccount, getOpenPaperTrades, isKillSwitchActive } from "@/lib/paper/database";
import { logRejectedTrade } from "@/lib/paper/engine";
import { getEffectivePaperRiskConfig, getRiskConfig } from "@/lib/risk/config";
import { checkTradeAllowed } from "@/lib/risk/engine";
import type { RiskCheckResult } from "@/lib/risk/types";
import { getWatchlist } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tradingMode = (url.searchParams.get("mode") === "live" ? "live" : "paper") satisfies TradingMode;
  const config = tradingMode === "paper" ? await getEffectivePaperRiskConfig() : getRiskConfig();
  const session = getTradingSession();
  const suggestions = [];
  const rejected = [];
  const suggestedSymbols = new Set<string>();

  for (const symbol of filterSymbolsForSession(getWatchlist())) {
    try {
      const quote = await getMarketQuote(symbol);
      const analysis = await analyzeSymbol(symbol, quote);

      if (analysis.action === "HOLD") {
        continue;
      }

      const paperAccount = await getPaperAccount();
      const openPositions = await getOpenPaperTrades();
      const risk = checkTradeAllowed({
        killSwitchActive: await isKillSwitchActive(),
        tradingMode,
        liveTradingEnabled: process.env.LIVE_TRADING === "true",
        analysis,
        quote,
        account: {
          equity: paperAccount.equity,
          availableCash: paperAccount.balance,
          dailyLoss: paperAccount.daily_loss,
        },
        openPositionsCount: openPositions.length,
        candidate: {
          symbol,
          side: analysis.action as TradeSide,
          entryPrice: analysis.suggested_entry,
          stopLoss: analysis.suggested_stop_loss,
          takeProfit: analysis.suggested_take_profit,
        },
        config,
      });

      if (risk.allowed) {
        suggestions.push({
          id: makeSuggestionId(symbol, analysis.action, quote.timestamp),
          symbol,
          action: analysis.action,
          quantity: risk.positionSize,
          entryPrice: analysis.suggested_entry,
          stopLoss: analysis.suggested_stop_loss,
          takeProfit: analysis.suggested_take_profit,
          riskAmount: risk.riskAmount,
          confidence: analysis.confidence,
          reasoning: analysis.reasoning,
          invalidationCondition: analysis.invalidation_condition,
          quoteTimestamp: quote.timestamp,
          source: "WATCHLIST",
        });
        suggestedSymbols.add(symbol);
      } else {
        rejected.push({ symbol, action: analysis.action, risk });
        await maybeLogRiskRejection(symbol, analysis.action, analysis.suggested_entry, analysis.suggested_stop_loss, analysis.suggested_take_profit, analysis.confidence, risk);
      }
    } catch (error) {
      rejected.push({ symbol, error: error instanceof Error ? error.message : "Unknown suggestion error" });
    }
  }

  if (process.env.OPPORTUNITY_SCANNER !== "false") {
    const opportunities = await scanOpportunities();

    for (const opportunity of opportunities) {
      if (opportunity.source === "MOCK" || suggestedSymbols.has(opportunity.symbol)) {
        continue;
      }

      try {
        const quote = await getMarketQuote(opportunity.symbol);
        const analysis = buildOpportunityAnalysis(opportunity);

        if (analysis.action === "HOLD") {
          continue;
        }

        const paperAccount = await getPaperAccount();
        const openPositions = await getOpenPaperTrades();
        const risk = checkTradeAllowed({
          killSwitchActive: await isKillSwitchActive(),
          tradingMode,
          liveTradingEnabled: process.env.LIVE_TRADING === "true",
          analysis,
          quote,
          account: {
            equity: paperAccount.equity,
            availableCash: paperAccount.balance,
            dailyLoss: paperAccount.daily_loss,
          },
          openPositionsCount: openPositions.length,
          candidate: {
            symbol: opportunity.symbol,
            side: analysis.action as TradeSide,
            entryPrice: analysis.suggested_entry,
            stopLoss: analysis.suggested_stop_loss,
            takeProfit: analysis.suggested_take_profit,
          },
          config,
        });

        if (risk.allowed) {
          suggestions.push({
            id: makeSuggestionId(opportunity.symbol, analysis.action, `${quote.timestamp}:${opportunity.source}:${opportunity.score}`),
            symbol: opportunity.symbol,
            action: analysis.action,
            quantity: risk.positionSize,
            entryPrice: analysis.suggested_entry,
            stopLoss: analysis.suggested_stop_loss,
            takeProfit: analysis.suggested_take_profit,
            riskAmount: risk.riskAmount,
            confidence: analysis.confidence,
            reasoning: analysis.reasoning,
            invalidationCondition: analysis.invalidation_condition,
            quoteTimestamp: quote.timestamp,
            source: opportunity.source,
            scannerScore: opportunity.score,
          });
          suggestedSymbols.add(opportunity.symbol);
        } else {
          rejected.push({ symbol: opportunity.symbol, action: analysis.action, source: opportunity.source, risk });
          await maybeLogRiskRejection(opportunity.symbol, analysis.action as TradeSide, analysis.suggested_entry, analysis.suggested_stop_loss, analysis.suggested_take_profit, analysis.confidence, risk);
        }
      } catch (error) {
        rejected.push({ symbol: opportunity.symbol, source: opportunity.source, error: error instanceof Error ? error.message : "Unknown scanner suggestion error" });
      }
    }
  }

  return NextResponse.json({
    suggestions,
    rejected,
    session,
    generatedAt: new Date().toISOString(),
  });
}

function makeSuggestionId(symbol: string, action: string, timestamp: string): string {
  return Buffer.from(`${symbol}:${action}:${timestamp}`).toString("base64url");
}

async function maybeLogRiskRejection(
  symbol: string,
  action: TradeSide,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  confidence: number,
  risk: RiskCheckResult,
): Promise<void> {
  if (risk.allowed) {
    return;
  }

  await logRejectedTrade({
    symbol,
    action,
    entryPrice,
    stopLoss,
    takeProfit,
    rejectionReason: risk.reason,
    aiConfidence: confidence,
    notes: `Rejected during suggestion: ${risk.detail}`,
  });
}
