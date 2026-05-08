import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { TradeSide } from "@/lib/etoro/types";
import { getEToroAdapter } from "@/lib/etoro";
import { getMarketQuote } from "@/lib/market";
import { getPaperAccount, getOpenPaperTrades, isKillSwitchActive } from "@/lib/paper/database";
import { executePaperTrade, logRejectedTrade } from "@/lib/paper/engine";
import { getEffectivePaperRiskConfig, getRiskConfig } from "@/lib/risk/config";
import { checkTradeAllowed } from "@/lib/risk/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  mode: z.enum(["paper", "live"]).default("paper"),
  symbol: z.string().min(1),
  action: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(500),
  invalidationCondition: z.string().min(1).max(500),
});

export async function POST(request: NextRequest) {
  const body = requestSchema.parse(await request.json());

  if (body.decision === "REJECT") {
    const trade = logRejectedTrade({
      symbol: body.symbol,
      action: body.action,
      entryPrice: body.entryPrice,
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
      rejectionReason: "MANUAL_REJECT",
      aiConfidence: body.confidence,
      notes: body.reasoning,
    });

    return NextResponse.json({ accepted: false, trade });
  }

  const adapter = getEToroAdapter();
  const quote = await getMarketQuote(body.symbol);
  const account = getPaperAccount();
  const riskConfig = body.mode === "paper" ? getEffectivePaperRiskConfig() : getRiskConfig();
  const risk = checkTradeAllowed({
    killSwitchActive: isKillSwitchActive(),
    tradingMode: body.mode,
    liveTradingEnabled: process.env.LIVE_TRADING === "true",
    analysis: {
      symbol: body.symbol,
      action: body.action,
      confidence: body.confidence,
      reasoning: body.reasoning,
      invalidation_condition: body.invalidationCondition,
      suggested_entry: body.entryPrice,
      suggested_stop_loss: body.stopLoss,
      suggested_take_profit: body.takeProfit,
      max_risk_pct: riskConfig.maxRiskPerTradePct,
    },
    quote,
    account: {
      equity: account.equity,
      availableCash: account.balance,
      dailyLoss: account.daily_loss,
    },
    openPositionsCount: getOpenPaperTrades().length,
    candidate: {
      symbol: body.symbol,
      side: body.action as TradeSide,
      entryPrice: body.entryPrice,
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
    },
    config: riskConfig,
  });

  if (!risk.allowed) {
    const trade = logRejectedTrade({
      symbol: body.symbol,
      action: body.action,
      entryPrice: body.entryPrice,
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
      rejectionReason: risk.reason,
      aiConfidence: body.confidence,
      notes: `Manual approval refused by risk engine: ${risk.detail}`,
    });

    return NextResponse.json({ accepted: false, risk, trade }, { status: 200 });
  }

  if (body.mode === "live") {
    const result = await adapter.placeOrder({
      symbol: body.symbol,
      side: body.action,
      quantity: body.quantity,
      orderType: "MARKET",
      mode: "live",
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
    });

    return NextResponse.json({ accepted: true, live: true, result });
  }

  const trade = executePaperTrade({
    symbol: body.symbol,
    action: body.action,
    quantity: body.quantity,
    entryPrice: body.entryPrice,
    stopLoss: body.stopLoss,
    takeProfit: body.takeProfit,
    aiConfidence: body.confidence,
    notes: `Accepted manually. ${body.reasoning}`,
  });

  return NextResponse.json({ accepted: true, live: false, trade, risk });
}
