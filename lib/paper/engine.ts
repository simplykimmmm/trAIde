import { activateKillSwitch, closePaperTrade, getOpenPaperTrades, getPaperAccount, insertPaperTrade, isKillSwitchActive, updatePaperAccount } from "./database";
import type { ExecutePaperTradeInput, PaperTrade, RejectedTradeInput } from "./types";

const FEE_RATE = 0.001;

export function executePaperTrade(input: ExecutePaperTradeInput): PaperTrade {
  if (isKillSwitchActive()) {
    return logRejectedTrade({
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

  const notional = input.quantity * input.entryPrice;
  const openingFee = roundMoney(notional * FEE_RATE);
  const account = getPaperAccount();

  updatePaperAccount({
    balance: roundMoney(account.balance - openingFee),
    equity: roundMoney(account.equity - openingFee),
    daily_loss: roundMoney(account.daily_loss + openingFee),
  });

  return insertPaperTrade({
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

export function logRejectedTrade(input: RejectedTradeInput): PaperTrade {
  return insertPaperTrade({
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

export function applyPriceUpdate(symbol: string, currentPrice: number): PaperTrade[] {
  const closed: PaperTrade[] = [];
  const openTrades = getOpenPaperTrades().filter((trade) => trade.symbol === symbol);

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
    const closingFee = Math.abs(currentPrice * trade.quantity) * FEE_RATE;
    const netPnl = roundMoney(grossPnl - closingFee);
    const status = hitTakeProfit ? "CLOSED_TP" : "CLOSED_SL";
    const account = getPaperAccount();

    updatePaperAccount({
      balance: roundMoney(account.balance + netPnl),
      equity: roundMoney(account.equity + netPnl),
      daily_loss: roundMoney(account.daily_loss + (netPnl < 0 ? Math.abs(netPnl) : 0)),
    });

    closed.push(closePaperTrade(trade.id, status, currentPrice, netPnl, roundMoney(closingFee)));
  }

  return closed;
}

export function haltAllPaperActivity(): void {
  activateKillSwitch();
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
