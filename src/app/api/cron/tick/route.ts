import { authorizeCron } from "@/lib/cron-auth";
import { tick, workerStatus } from "@/lib/queue/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled worker pass for serverless hosts, where no background loop survives between requests:
 * retries failed webhook deliveries and queued invoices, polls the mailbox, syncs the ERP.
 * .github/workflows/cron.yml calls it every 10 minutes with a GitHub OIDC token (no secret to
 * manage); any other scheduler can send `Authorization: Bearer $CRON_SECRET`. See lib/cron-auth.ts.
 */
async function run(req: Request) {
  const auth = await authorizeCron(req);
  if (!auth.ok) return Response.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  const started = Date.now();
  await tick();
  return Response.json({ ok: true, via: auth.via, ms: Date.now() - started, worker: workerStatus() }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
