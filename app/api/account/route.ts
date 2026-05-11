import { NextResponse } from "next/server";
import { getMarketDataProvider } from "@/lib/market";
import { getTradingSession } from "@/lib/market/session";
import { getEffectivePaperRiskConfig } from "@/lib/risk/config";
import { getBotSettings, getOpenPaperTrades, getPaperAccount, isBotRunning, isKillSwitchActive } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await getPaperAccount();
  const openPositions = await getOpenPaperTrades();
  const riskConfig = await getEffectivePaperRiskConfig();
  const dailyLossLimit = account.equity * riskConfig.maxDailyLossPct;
  const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_URL);
  const hasFinnhubKey = Boolean(process.env.FINNHUB_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const botRunning = await isBotRunning();
  const session = getTradingSession();
  const deploymentWarnings = [
    !hasFinnhubKey ? "FINNHUB_API_KEY is missing in this deployment, so market data falls back to mock quotes." : null,
    !hasGeminiKey ? "GEMINI_API_KEY is missing in this deployment, so AI analysis falls back to cautious mock HOLD responses." : null,
    isVercel ? "SQLite state on Vercel serverless storage can reset between deployments or cold starts. Use a hosted database for persistent bot/trade state." : null,
    !botRunning ? "Bot is paused. Click Start to begin the paper refresh loop; trades still require manual approval." : null,
  ].filter((warning): warning is string => Boolean(warning));

  return NextResponse.json({
    mode: "paper",
    marketDataProvider: getMarketDataProvider(),
    liveTradingEnabled: process.env.LIVE_TRADING === "true",
    killSwitchActive: await isKillSwitchActive(),
    botRunning,
    botSettings: await getBotSettings(),
    session,
    deployment: {
      host: isVercel ? "vercel" : "local",
      hasFinnhubKey,
      hasGeminiKey,
      storage: isVercel ? "ephemeral-sqlite" : "local-sqlite",
      warnings: deploymentWarnings,
    },
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
