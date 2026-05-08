import { NextResponse } from "next/server";
import { getMarketDataProvider } from "@/lib/market";
import { getEffectivePaperRiskConfig } from "@/lib/risk/config";
import { getBotSettings, getOpenPaperTrades, getPaperAccount, isBotRunning, isKillSwitchActive } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = getPaperAccount();
  const openPositions = getOpenPaperTrades();
  const riskConfig = getEffectivePaperRiskConfig();
  const dailyLossLimit = account.equity * riskConfig.maxDailyLossPct;

  return NextResponse.json({
    mode: "paper",
    marketDataProvider: getMarketDataProvider(),
    liveTradingEnabled: process.env.LIVE_TRADING === "true",
    killSwitchActive: isKillSwitchActive(),
    botRunning: isBotRunning(),
    botSettings: getBotSettings(),
    account: {
      accountId: "paper-local",
      currency: "USD",
      balance: account.balance,
      equity: account.equity,
      availableCash: account.balance,
      dailyPnl: -account.daily_loss,
      dailyLoss: account.daily_loss,
      dailyLossLimit,
      dailyLossUsedPct: dailyLossLimit > 0 ? account.daily_loss / dailyLossLimit : 0,
      openPositionCount: openPositions.length,
      updatedAt: new Date().toISOString(),
    },
    riskConfig,
  });
}
