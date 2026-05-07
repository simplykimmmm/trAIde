import { NextResponse } from "next/server";
import { listPaperTrades } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ trades: listPaperTrades(50) });
}
