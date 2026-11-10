import { NextResponse } from "next/server";
import { computeAccuracy } from "@/lib/accuracy";
import { requireActor } from "@/lib/auth/guard";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  return NextResponse.json(await computeAccuracy(g.actor.orgId));
}
