import { NextResponse } from "next/server";
import type { Position } from "@/lib/etoro/types";
import { getMarketQuote } from "@/lib/market";
import { applyPriceUpdate } from "@/lib/paper/engine";
import { getOpenPaperTrades } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const initialOpenTrades = await getOpenPaperTrades();
  const quoteBySymbol = new Map<string, number>();

  for (const trade of initialOpenTrades) {
    try {
      const quote = await getMarketQuote(trade.symbol);
      quoteBySymbol.set(trade.symbol, quote.last);
      await applyPriceUpdate(trade.symbol, quote.last);
    } catch {
      quoteBySymbol.set(trade.symbol, trade.entry_price);
    }
  }

  const positions: Position[] = (await getOpenPaperTrades()).map((trade) => {
    const currentPrice = quoteBySymbol.get(trade.symbol) ?? trade.entry_price;
    const unrealizedPnl =
      trade.action === "BUY"
        ? (currentPrice - trade.entry_price) * trade.quantity
        : (trade.entry_price - currentPrice) * trade.quantity;

    return {
      id: String(trade.id),
      symbol: trade.symbol,
      side: trade.action === "BUY" ? "LONG" : "SHORT",
      quantity: trade.quantity,
      entryPrice: trade.entry_price,
      currentPrice,
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      stopLoss: trade.stop_loss,
      takeProfit: trade.take_profit,
      openedAt: trade.timestamp,
    };
  });

  return NextResponse.json({ positions });
}
