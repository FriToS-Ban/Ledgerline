import { NextResponse } from "next/server";
import { drainQueue, workerStatus } from "@/lib/queue/worker";

export async function POST() {
  const r = await drainQueue();
  return NextResponse.json({ ...r, worker: workerStatus() });
}
