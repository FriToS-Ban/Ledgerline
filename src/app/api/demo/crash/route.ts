import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { claimNext } from "@/lib/queue/jobs";
import { requireOrgRole } from "@/lib/auth/guard";

/**
 * Demo of crash safety: grab up to 3 queued jobs and abandon them mid-flight, exactly as a
 * killed worker would. Their short lease then expires and the worker picks them up again.
 */
export async function POST() {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const { orgId } = g.actor;
  const abandoned: string[] = [];
  for (let i = 0; i < 3; i++) {
    const job = await claimNext(orgId);
    if (!job) break;
    await getDb()
      .update(t.jobs)
      .set({ lockedUntil: new Date(Date.now() + 8_000) })
      .where(and(eq(t.jobs.orgId, orgId), eq(t.jobs.id, job.id)));
    abandoned.push(job.id);
  }
  return NextResponse.json({ abandoned: abandoned.length, leaseSeconds: 8 });
}
