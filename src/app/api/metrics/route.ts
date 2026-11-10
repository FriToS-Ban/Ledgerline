import { NextResponse } from "next/server";
import { computeMetrics } from "@/lib/metrics";
import { requireSignedIn } from "@/lib/auth/guard";

export async function GET() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  return NextResponse.json(await computeMetrics());
}
