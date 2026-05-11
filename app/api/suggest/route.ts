import { NextRequest, NextResponse } from "next/server";
import { analyzeSymbol } from "@/lib/ai/analyzeSymbol";
import type { TradeSide, TradingMode } from "@/lib/etoro/types";
import { getMarketQuote } from "@/lib/market";
import { filterSymbolsForSession, getTradingSession } from "@/lib/market/session";
import { buildOpportunityAnalysis, scanOpportunities } from "@/lib/opportunities/scanner";
import { getPaperAccount, getOpenPaperTrades, isBotRunning, isKillSwitchActive } from "@/lib/paper/database";
import { executePaperTrade, logRejectedTrade } from "@/lib/paper/engine";
import { getEffectivePaperRiskConfig, getRiskConfig } from "@/lib/risk/config";
import { checkTradeAllowed } from "@/lib/risk/engine";
import type { RiskCheckResult, RiskConfig } from "@/lib/risk/types";
import { getWatchlist } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Suggestion = {
  id: string;
  symbol: string;
  action: TradeSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  confidence: number;
  reasoning: string;
  invalidationCondition: string;
  quoteTimestamp: string;
  source: string;
  scannerScore?: number;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tradingMode = (url.searchParams.get("mode") === "live" ? "live" : "paper") satisfies TradingMode;
  const config = tradingMode === "paper" ? await getEffectivePaperRiskConfig() : getRiskConfig();
  const session = getTradingSession();
  const suggestions: Suggestion[] = [];
  const rejected = [];
  const suggestedSymbols = new Set<string>();

  for (const symbol of filterSymbolsForSession(getWatchlist()).slice(0, Number(process.env.WATCHLIST_ANALYSIS_LIMIT ?? 2))) {
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

  const autoExecutedTrades = await maybeAutoExecutePaperTrades(suggestions, tradingMode, config);

  return NextResponse.json({
    suggestions,
    autoExecutedTrades,
    rejected,
    session,
    autoPaperTradingEnabled: isAutoPaperTradingEnabled(),
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

async function maybeAutoExecutePaperTrades(suggestions: Suggestion[], tradingMode: TradingMode, config: RiskConfig): Promise<Array<{ id: number; symbol: string; action: string; quantity: number }>> {
  if (tradingMode !== "paper" || !isAutoPaperTradingEnabled() || !(await isBotRunning()) || (await isKillSwitchActive())) {
    return [];
  }

  const executed = [];

  for (const suggestion of suggestions) {
    const quote = await getMarketQuote(suggestion.symbol);
    const account = await getPaperAccount();
    const openPositions = await getOpenPaperTrades();
    const risk = checkTradeAllowed({
      killSwitchActive: await isKillSwitchActive(),
      tradingMode: "paper",
      liveTradingEnabled: false,
      analysis: {
        symbol: suggestion.symbol,
        action: suggestion.action,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
        invalidation_condition: suggestion.invalidationCondition,
        suggested_entry: suggestion.entryPrice,
        suggested_stop_loss: suggestion.stopLoss,
        suggested_take_profit: suggestion.takeProfit,
        max_risk_pct: config.maxRiskPerTradePct,
      },
      quote,
      account: {
        equity: account.equity,
        availableCash: account.balance,
        dailyLoss: account.daily_loss,
      },
      openPositionsCount: openPositions.length,
      candidate: {
        symbol: suggestion.symbol,
        side: suggestion.action,
        entryPrice: suggestion.entryPrice,
        stopLoss: suggestion.stopLoss,
        takeProfit: suggestion.takeProfit,
      },
      config,
    });

    if (!risk.allowed) {
      await maybeLogRiskRejection(suggestion.symbol, suggestion.action, suggestion.entryPrice, suggestion.stopLoss, suggestion.takeProfit, suggestion.confidence, risk);
      continue;
    }

    const trade = await executePaperTrade({
      symbol: suggestion.symbol,
      action: suggestion.action,
      quantity: risk.positionSize,
      entryPrice: suggestion.entryPrice,
      stopLoss: suggestion.stopLoss,
      takeProfit: suggestion.takeProfit,
      aiConfidence: suggestion.confidence,
      notes: `Auto paper trade while bot running. ${suggestion.source}: ${suggestion.reasoning}`,
    });

    executed.push({
      id: trade.id,
      symbol: trade.symbol,
      action: trade.action,
      quantity: trade.quantity,
    });
  }

  return executed;
}

function isAutoPaperTradingEnabled(): boolean {
  return process.env.AUTO_PAPER_TRADING === "true";
}
