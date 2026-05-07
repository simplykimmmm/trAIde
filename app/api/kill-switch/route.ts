import { NextResponse } from "next/server";
import { haltAllPaperActivity } from "@/lib/paper/engine";
import { deactivateKillSwitch, isKillSwitchActive } from "@/lib/paper/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ active: isKillSwitchActive() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body?.active === false) {
    deactivateKillSwitch();
  } else {
    haltAllPaperActivity();
  }

  return NextResponse.json({ active: isKillSwitchActive() });
}
