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

  const account = await getPaperAccount();
  const execution = modelEntryExecution(input, account.equity);

  if (execution.quantity <= 0) {
    return await logRejectedTrade({
      symbol: input.symbol,
      action: input.action,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      rejectionReason: "NO_REALISTIC_FILL",
      aiConfidence: input.aiConfidence,
      notes: "Paper trade refused because the realistic liquidity model could not fill any size.",
    });
  }

  await updatePaperAccount({
    balance: roundMoney(account.balance - execution.fee),
    equity: roundMoney(account.equity - execution.fee),
    daily_loss: roundMoney(account.daily_loss + execution.fee),
  });

  return await insertPaperTrade({
    timestamp: new Date().toISOString(),
    symbol: input.symbol,
    action: input.action,
    quantity: execution.quantity,
    entry_price: execution.fillPrice,
    stop_loss: input.stopLoss,
    take_profit: input.takeProfit,
    status: "OPEN",
    close_price: null,
    pnl: null,
    fee_approx: execution.fee,
    rejection_reason: null,
    ai_confidence: input.aiConfidence,
    notes: [input.notes, execution.note].filter(Boolean).join(" "),
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

    const exit = modelExitExecution(trade, currentPrice, hitStopLoss);
    const grossPnl =
      trade.action === "BUY"
        ? (exit.fillPrice - trade.entry_price) * trade.quantity
        : (trade.entry_price - exit.fillPrice) * trade.quantity;
    const closingFee = exit.fee;
    const netPnl = roundMoney(grossPnl - closingFee);
    const status = hitTakeProfit ? "CLOSED_TP" : "CLOSED_SL";
    const account = await getPaperAccount();

    await updatePaperAccount({
      balance: roundMoney(account.balance + netPnl),
      equity: roundMoney(account.equity + netPnl),
      daily_loss: roundMoney(account.daily_loss + (netPnl < 0 ? Math.abs(netPnl) : 0)),
    });

    closed.push(await closePaperTrade(trade.id, status, exit.fillPrice, netPnl, roundMoney(closingFee)));
  }

  return closed;
}

export async function haltAllPaperActivity(): Promise<void> {
  await activateKillSwitch();
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function modelEntryExecution(input: ExecutePaperTradeInput, equity: number): { quantity: number; fillPrice: number; fee: number; note: string } {
  const maxFillNotional = getMaxFillNotional(input.symbol, equity);
  const requestedNotional = Math.max(input.quantity * input.entryPrice, 0);
  const filledNotional = Math.min(requestedNotional, maxFillNotional);
  const quantity = input.entryPrice > 0 ? filledNotional / input.entryPrice : 0;
  const fillPrice = applyAdverseExecutionPrice(input.action, input.entryPrice, executionCostBps(input.symbol, filledNotional, false));
  const fee = calculateExecutionFee(quantity * fillPrice);
  const partialFillNote = requestedNotional > filledNotional
    ? `Partial fill: requested ${money(requestedNotional)}, capped at ${money(filledNotional)} by simulated liquidity.`
    : "";

  return {
    quantity: roundQuantity(quantity),
    fillPrice: roundPrice(fillPrice),
    fee,
    note: `Simulated realistic fill with spread, slippage, market impact, and fees. ${partialFillNote}`.trim(),
  };
}

function modelExitExecution(trade: PaperTrade, marketPrice: number, stopLossHit: boolean): { fillPrice: number; fee: number } {
  const notional = Math.max(trade.quantity * marketPrice, 0);
  const costBps = executionCostBps(trade.symbol, notional, stopLossHit);
  const fillPrice = applyAdverseExecutionPrice(trade.action === "BUY" ? "SELL" : "BUY", marketPrice, costBps);

  return {
    fillPrice: roundPrice(fillPrice),
    fee: calculateExecutionFee(trade.quantity * fillPrice),
  };
}

function executionCostBps(symbol: string, notional: number, stopLossHit: boolean): number {
  const liquidityCap = getAssetLiquidityCap(symbol);
  const spreadBps = readNumber("PAPER_SPREAD_BPS", isCrypto(symbol) ? 12 : 8);
  const slippageBps = readNumber("PAPER_SLIPPAGE_BPS", isCrypto(symbol) ? 20 : 12);
  const impactAtCapBps = readNumber("PAPER_MARKET_IMPACT_BPS", 35);
  const maxImpactBps = readNumber("PAPER_MAX_MARKET_IMPACT_BPS", 150);
  const stopGapBps = stopLossHit ? readNumber("PAPER_STOP_GAP_BPS", 35) : 0;
  const impactBps = Math.min(maxImpactBps, (Math.max(notional, 0) / liquidityCap) * impactAtCapBps);

  return spreadBps / 2 + slippageBps + impactBps + stopGapBps;
}

function applyAdverseExecutionPrice(action: "BUY" | "SELL", price: number, costBps: number): number {
  const multiplier = costBps / 10_000;
  return action === "BUY" ? price * (1 + multiplier) : price * (1 - multiplier);
}

function calculateExecutionFee(notional: number): number {
  const fixedFee = readNumber("PAPER_FIXED_FEE_USD", PAPER_TRANSACTION_FEE);
  const feeBps = readNumber("PAPER_FEE_BPS", 10);
  return roundMoney(fixedFee + Math.max(notional, 0) * (feeBps / 10_000));
}

function getMaxFillNotional(symbol: string, equity: number): number {
  const equityCapPct = clamp(readNumber("PAPER_MAX_POSITION_NOTIONAL_PCT", 0.25), 0.01, 1);
  const accountCap = Math.max(equity, 0) * equityCapPct;
  return Math.max(0, Math.min(accountCap, getAssetLiquidityCap(symbol)));
}

function getAssetLiquidityCap(symbol: string): number {
  return isCrypto(symbol)
    ? readNumber("PAPER_CRYPTO_LIQUIDITY_CAP_USD", 25_000)
    : readNumber("PAPER_STOCK_LIQUIDITY_CAP_USD", 15_000);
}

function isCrypto(symbol: string): boolean {
  return symbol.includes("/");
}

function readNumber(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(value < 1 ? 6 : 4));
}

function roundQuantity(value: number): number {
  return Number(value.toFixed(6));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function money(value: number): string {
  return `$${roundMoney(value).toLocaleString("en-US")}`;
}
