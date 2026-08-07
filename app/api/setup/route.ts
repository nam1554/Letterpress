import { NextRequest, NextResponse } from "next/server";
import { getBackendSetup } from "@/lib/setup";

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const backends = await getBackendSetup(force);
  return NextResponse.json({ backends });
}
