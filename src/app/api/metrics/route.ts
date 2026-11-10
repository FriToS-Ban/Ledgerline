import { NextResponse } from "next/server";
import { computeMetrics } from "@/lib/metrics";
import { requireActor } from "@/lib/auth/guard";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  return NextResponse.json(await computeMetrics(g.actor.orgId));
}
