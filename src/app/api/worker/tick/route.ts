import { NextResponse } from "next/server";
import { drainQueue, workerStatus } from "@/lib/queue/worker";
import { requireActor } from "@/lib/auth/guard";

export async function POST() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const r = await drainQueue(50, g.actor.orgId);
  return NextResponse.json({ ...r, worker: workerStatus() });
}
