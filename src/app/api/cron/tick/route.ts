import { secretsEqual } from "@/lib/auth/secret";
import { tick, workerStatus } from "@/lib/queue/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled worker pass for serverless hosts, where no background loop survives between requests:
 * retries failed webhook deliveries and queued invoices, polls the mailbox, syncs the ERP.
 * Call it every few minutes with `Authorization: Bearer $CRON_SECRET` (a free GitHub Actions
 * schedule does this: .github/workflows/cron.yml; Vercel Cron sends the same header).
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) {
    return Response.json({ error: "CRON_SECRET (>= 24 chars) is not configured" }, { status: 503 });
  }
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secretsEqual(given, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  await tick();
  return Response.json({ ok: true, ms: Date.now() - started, worker: workerStatus() }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
