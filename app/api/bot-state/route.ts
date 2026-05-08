import { NextResponse } from "next/server";
import { isBotRunning, isKillSwitchActive, setBotRunning } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ running: isBotRunning(), killSwitchActive: isKillSwitchActive() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requested = body?.running === true;

  if (requested && isKillSwitchActive()) {
    setBotRunning(false);
    return NextResponse.json({ running: false, killSwitchActive: true, error: "KILL_SWITCH_ACTIVE" }, { status: 409 });
  }

  setBotRunning(requested);
  return NextResponse.json({ running: isBotRunning(), killSwitchActive: isKillSwitchActive() });
}
