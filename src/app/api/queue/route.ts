import { NextRequest, NextResponse } from "next/server";
import { queueStats, retryDead } from "@/lib/queue/jobs";
import { workerStatus } from "@/lib/queue/worker";
import { denyUnless, requireSignedIn } from "@/lib/auth/guard";

export async function GET() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  return NextResponse.json({ ...(await queueStats()), worker: workerStatus() });
}

export async function POST(req: NextRequest) {
  const denied = await denyUnless(["approver", "admin"]);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });
  const body = (await req.json().catch(() => ({}))) as { retry?: string | "all" };
  await retryDead(body.retry && body.retry !== "all" ? body.retry : undefined);
  return NextResponse.json(await queueStats());
}
