import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth/guard";
import { listBatches, listPayables } from "@/lib/payments";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const [payables, batches] = await Promise.all([listPayables(g.actor.orgId), listBatches(g.actor.orgId)]);
  return NextResponse.json({ payables, batches }, { headers: { "Cache-Control": "no-store" } });
}
