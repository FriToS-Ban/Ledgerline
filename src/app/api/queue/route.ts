import { NextRequest, NextResponse } from "next/server";
import { queueStats, retryDead } from "@/lib/queue/jobs";
import { workerStatus } from "@/lib/queue/worker";
import { requireActor, requireOrgRole } from "@/lib/auth/guard";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  return NextResponse.json({ ...(await queueStats(g.actor.orgId)), worker: workerStatus() });
}

export async function POST(req: NextRequest) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const body = (await req.json().catch(() => ({}))) as { retry?: string | "all" };
  await retryDead(g.actor.orgId, body.retry && body.retry !== "all" ? body.retry : undefined);
  return NextResponse.json(await queueStats(g.actor.orgId));
}
