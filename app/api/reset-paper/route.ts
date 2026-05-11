import { NextResponse } from "next/server";
import { resetPaperTrading } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body?.confirm !== "RESET_PAPER") {
    return NextResponse.json({ error: "RESET_CONFIRMATION_REQUIRED" }, { status: 400 });
  }

  const requestedBalance = Number(body?.startingBalance ?? process.env.PAPER_START_BALANCE ?? 100_000);
  const account = await resetPaperTrading(requestedBalance);

  return NextResponse.json({
    ok: true,
    account,
    message: `Paper account reset to ${account.balance}. All paper trades cleared and bot paused.`,
  });
}
