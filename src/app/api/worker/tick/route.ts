import { NextResponse } from "next/server";
import { drainQueue, workerStatus } from "@/lib/queue/worker";
import { requireSignedIn } from "@/lib/auth/users";

export async function POST() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  const r = await drainQueue();
  return NextResponse.json({ ...r, worker: workerStatus() });
}
