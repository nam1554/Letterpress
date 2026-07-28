import { NextRequest, NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const checks = await runHealthChecks(force);
  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
