import { claimNext, completeJob, failJob } from "./jobs";
import { runJob } from "./handlers";

type WorkerState = { timer: NodeJS.Timeout | null; busy: boolean; lastTick: string | null };
const g = globalThis as unknown as { __apWorker?: WorkerState };

/**
 * Drain all currently runnable jobs, several at a time (WORKER_CONCURRENCY, default 4) because most
 * of each invoice's time is spent waiting on a model. claimNext is compare-and-set, so lanes never
 * take the same job. Safe to call concurrently (re-entrancy guarded).
 */
export async function drainQueue(maxJobs = 50, orgId?: string) {
  const state = (g.__apWorker ??= { timer: null, busy: false, lastTick: null });
  if (state.busy) return { ran: 0, skipped: true };
  state.busy = true;
  let ran = 0;
  const lanes = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 4));
  try {
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        while (ran < maxJobs) {
          const job = await claimNext(orgId);
          if (!job) break;
          ran++;
          try {
            await runJob(job);
            await completeJob(job);
          } catch (err) {
            await failJob(job, err);
          }
        }
      }),
    );
  } finally {
    state.busy = false;
    state.lastTick = new Date().toISOString();
  }
  return { ran, skipped: false };
}

async function tick() {
  // Folder / ERP / mailbox connectors are deployment-wide: they feed one explicitly configured org.
  const { resolveServiceOrg } = await import("@/lib/db/org");
  const serviceOrg = await resolveServiceOrg().catch(() => null);
  try {
    const { syncMasterFolder } = await import("@/lib/master/sync");
    if (serviceOrg) await syncMasterFolder(serviceOrg);
  } catch (err) {
    console.error("[worker] master sync failed", err);
  }
  try {
    const { syncErpIfDue } = await import("@/lib/master/erp");
    if (serviceOrg) await syncErpIfDue(serviceOrg);
  } catch (err) {
    console.error("[worker] ERP sync failed", err);
  }
  try {
    const { pollMailbox, imapConfigured } = await import("@/lib/email/imap");
    if (serviceOrg && imapConfigured()) await pollMailbox(serviceOrg);
  } catch (err) {
    console.error("[worker] mailbox poll failed", err);
  }
  try {
    await drainQueue();
  } catch (err) {
    console.error("[worker] drain failed", err);
  }
}

export function startWorker(intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 15_000)) {
  const state = (g.__apWorker ??= { timer: null, busy: false, lastTick: null });
  if (state.timer) return;
  state.timer = setInterval(tick, intervalMs);
  state.timer.unref?.();
  void tick(); // recover stale/queued jobs immediately after a restart
}

export function workerStatus() {
  const s = g.__apWorker;
  return { running: !!s?.timer, busy: !!s?.busy, lastTick: s?.lastTick ?? null };
}
