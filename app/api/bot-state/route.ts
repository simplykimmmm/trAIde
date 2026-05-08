import { NextResponse } from "next/server";
import { getBotSettings, isBotRunning, isKillSwitchActive, setBotRunning, setBotSettings } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ running: isBotRunning(), killSwitchActive: isKillSwitchActive(), settings: getBotSettings() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requested = typeof body?.running === "boolean" ? body.running === true : isBotRunning();
  const settings = setBotSettings({
    refreshIntervalMinutes: typeof body?.refreshIntervalMinutes === "number" ? body.refreshIntervalMinutes : undefined,
    riskMultiplier: typeof body?.riskMultiplier === "number" ? body.riskMultiplier : undefined,
  });

  if (requested && isKillSwitchActive()) {
    setBotRunning(false);
    return NextResponse.json({ running: false, killSwitchActive: true, settings, error: "KILL_SWITCH_ACTIVE" }, { status: 409 });
  }

  setBotRunning(requested);
  return NextResponse.json({ running: isBotRunning(), killSwitchActive: isKillSwitchActive(), settings: getBotSettings() });
}
