/**
 * Runs one demo invoice through the real pipeline and shows which model wrote the memo.
 * Usage: npx tsx --env-file=.env scripts/llm-check.ts   (uses a scratch DB, not data/app.db)
 */
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `llm-check-${Date.now()}.db`).replace(/\\/g, "/")}`;

async function main() {
  const { seedDatabase } = await import("../src/lib/db/seed");
  const { createInvoiceRecord, processCase } = await import("../src/lib/process-case");
  const { modelLabel, activeProvider } = await import("../src/mastra/model");
  const { getDb } = await import("../src/lib/db/client");
  const t = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  console.log("provider:", activeProvider(), "| model:", modelLabel());
  await seedDatabase();
  const invoiceId = await createInvoiceRecord({ demoId: "tax-shipping", runId: randomUUID() });
  const started = Date.now();
  const { trace } = await processCase({ invoiceId, demoId: "tax-shipping" });
  console.log(`processed in ${Date.now() - started}ms`);
  console.log("recommendation:", trace.decision.recommendation);
  console.log("analystModel:", trace.decision.analystModel);
  console.log("headline:", trace.decision.analystHeadline);
  console.log("memo:", (trace.decision.analystNote ?? "").slice(0, 500));
  const ev = await getDb().select().from(t.auditEvents).where(eq(t.auditEvents.invoiceId, invoiceId));
  for (const e of ev.filter((x) => x.step.startsWith("mastra"))) {
    console.log("event", e.step, e.status, e.payload.slice(0, 160));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
