import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, or, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

export type JobKind = "process-invoice" | "resume-invoice" | "deliver-webhook";
export type JobRow = typeof t.jobs.$inferSelect;

const LEASE_MS = 5 * 60_000;
/** Exponential backoff: 5s, 20s, 80s ... capped at 10 minutes. */
export function backoffMs(attempt: number) {
  return Math.min(5_000 * 4 ** (attempt - 1), 10 * 60_000);
}

export async function enqueue(orgId: string, kind: JobKind, payload: unknown, opts: { maxAttempts?: number } = {}) {
  const now = new Date();
  const id = randomUUID();
  await getDb().insert(t.jobs).values({
    orgId,
    id,
    kind,
    payload: JSON.stringify(payload),
    status: "queued",
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 4,
    runAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/**
 * Claim the next runnable job. The background worker serves every org (each job carries its own
 * org_id and runs as that org); request-driven callers pass their own orgId to only touch their jobs. A job is runnable when queued and due, or when it
 * was "running" but its lease expired (worker crashed mid-job).
 */
export async function claimNext(orgId?: string): Promise<JobRow | null> {
  const db = getDb();
  const now = new Date();
  const runnable = or(
    and(eq(t.jobs.status, "queued"), lte(t.jobs.runAt, now)),
    and(eq(t.jobs.status, "running"), or(isNull(t.jobs.lockedUntil), lte(t.jobs.lockedUntil, now))),
  );
  const candidates = await db
    .select()
    .from(t.jobs)
    .where(orgId ? and(eq(t.jobs.orgId, orgId), runnable) : runnable)
    .orderBy(asc(t.jobs.runAt))
    .limit(5);
  for (const job of candidates) {
    // Compare-and-set on (status, attempts) so two workers can't both take it.
    const lease = new Date(Date.now() + LEASE_MS);
    const res = await db
      .update(t.jobs)
      .set({ status: "running", lockedUntil: lease, attempts: job.attempts + 1, updatedAt: now })
      .where(and(eq(t.jobs.orgId, job.orgId), eq(t.jobs.id, job.id), eq(t.jobs.status, job.status), eq(t.jobs.attempts, job.attempts)));
    if (res.rowCount === 1) return { ...job, status: "running", attempts: job.attempts + 1, lockedUntil: lease };
  }
  return null;
}

export async function completeJob(job: Pick<JobRow, "orgId" | "id">) {
  await getDb()
    .update(t.jobs)
    .set({ status: "done", lockedUntil: null, lastError: null, updatedAt: new Date() })
    .where(and(eq(t.jobs.orgId, job.orgId), eq(t.jobs.id, job.id)));
}

export async function failJob(job: JobRow, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const dead = job.attempts >= job.maxAttempts;
  await getDb()
    .update(t.jobs)
    .set({
      status: dead ? "dead" : "queued",
      lockedUntil: null,
      lastError: message.slice(0, 2000),
      runAt: new Date(Date.now() + backoffMs(job.attempts)),
      updatedAt: new Date(),
    })
    .where(and(eq(t.jobs.orgId, job.orgId), eq(t.jobs.id, job.id)));
  return dead;
}

export async function queueStats(orgId: string) {
  const rows = await getDb().select().from(t.jobs).where(eq(t.jobs.orgId, orgId));
  const counts: Record<string, number> = { queued: 0, running: 0, done: 0, dead: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { counts, recent: rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 20) };
}

export async function retryDead(orgId: string, id?: string) {
  const db = getDb();
  const now = new Date();
  const q = db.update(t.jobs).set({ status: "queued", attempts: 0, runAt: now, updatedAt: now });
  await q.where(id ? and(eq(t.jobs.orgId, orgId), eq(t.jobs.id, id)) : and(eq(t.jobs.orgId, orgId), eq(t.jobs.status, "dead")));
}
