import { NextResponse } from "next/server";
import { scanOpportunities } from "@/lib/opportunities/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const opportunities = await scanOpportunities();

  return NextResponse.json({
    opportunities,
    generatedAt: new Date().toISOString(),
    disclaimer: "Scanner ideas are educational paper-trading candidates, not financial advice or profit guarantees.",
  });
}
