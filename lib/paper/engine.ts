import { activateKillSwitch, closePaperTrade, getOpenPaperTrades, getPaperAccount, insertPaperTrade, isKillSwitchActive, updatePaperAccount } from "./database";
import type { ExecutePaperTradeInput, PaperTrade, RejectedTradeInput } from "./types";

export const PAPER_TRANSACTION_FEE = 1;

export async function executePaperTrade(input: ExecutePaperTradeInput): Promise<PaperTrade> {
  if (await isKillSwitchActive()) {
    return await logRejectedTrade({
      symbol: input.symbol,
      action: input.action,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      rejectionReason: "KILL_SWITCH_ACTIVE",
      aiConfidence: input.aiConfidence,
      notes: "Paper trade refused because the kill switch is active.",
    });
  }

  const openingFee = PAPER_TRANSACTION_FEE;
  const account = await getPaperAccount();

  await updatePaperAccount({
    balance: roundMoney(account.balance - openingFee),
    equity: roundMoney(account.equity - openingFee),
    daily_loss: roundMoney(account.daily_loss + openingFee),
  });

  return await insertPaperTrade({
    timestamp: new Date().toISOString(),
    symbol: input.symbol,
    action: input.action,
    quantity: input.quantity,
    entry_price: input.entryPrice,
    stop_loss: input.stopLoss,
    take_profit: input.takeProfit,
    status: "OPEN",
    close_price: null,
    pnl: null,
    fee_approx: openingFee,
    rejection_reason: null,
    ai_confidence: input.aiConfidence,
    notes: input.notes,
  });
}

export async function logRejectedTrade(input: RejectedTradeInput): Promise<PaperTrade> {
  return await insertPaperTrade({
    timestamp: new Date().toISOString(),
    symbol: input.symbol,
    action: input.action === "HOLD" ? "HOLD" : "REJECT",
    quantity: 0,
    entry_price: input.entryPrice,
    stop_loss: input.stopLoss ?? 0,
    take_profit: input.takeProfit ?? 0,
    status: "REJECTED",
    close_price: null,
    pnl: 0,
    fee_approx: 0,
    rejection_reason: input.rejectionReason,
    ai_confidence: input.aiConfidence ?? null,
    notes: input.notes,
  });
}

export async function applyPriceUpdate(symbol: string, currentPrice: number): Promise<PaperTrade[]> {
  const closed: PaperTrade[] = [];
  const openTrades = (await getOpenPaperTrades()).filter((trade) => trade.symbol === symbol);

  for (const trade of openTrades) {
    const hitTakeProfit = trade.action === "BUY" ? currentPrice >= trade.take_profit : currentPrice <= trade.take_profit;
    const hitStopLoss = trade.action === "BUY" ? currentPrice <= trade.stop_loss : currentPrice >= trade.stop_loss;

    if (!hitTakeProfit && !hitStopLoss) {
      continue;
    }

    const grossPnl =
      trade.action === "BUY"
        ? (currentPrice - trade.entry_price) * trade.quantity
        : (trade.entry_price - currentPrice) * trade.quantity;
    const closingFee = PAPER_TRANSACTION_FEE;
    const netPnl = roundMoney(grossPnl - closingFee);
    const status = hitTakeProfit ? "CLOSED_TP" : "CLOSED_SL";
    const account = await getPaperAccount();

    await updatePaperAccount({
      balance: roundMoney(account.balance + netPnl),
      equity: roundMoney(account.equity + netPnl),
      daily_loss: roundMoney(account.daily_loss + (netPnl < 0 ? Math.abs(netPnl) : 0)),
    });

    closed.push(await closePaperTrade(trade.id, status, currentPrice, netPnl, roundMoney(closingFee)));
  }

  return closed;
}

export async function haltAllPaperActivity(): Promise<void> {
  await activateKillSwitch();
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
