import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { PipelineTrace } from "@/lib/invoice/schema";
import { queueStats } from "@/lib/queue/jobs";

export const MANUAL_MINUTES_PER_INVOICE = Number(process.env.MANUAL_MINUTES_PER_INVOICE ?? 6);

const RULE_LABEL: Record<string, string> = {
  "extraction.confidence": "Unreadable fields",
  "vendor.approved": "Vendor not approved",
  "amount.tolerance": "Amount outside tolerance",
  "duplicate.exact": "Exact duplicate",
  "duplicate.near": "Possible duplicate",
  "po.open": "No open PO",
  "po.match": "No PO match",
  "po.implied": "PO inferred, needs check",
  "po.multi": "Multi-PO split",
  "fx.missing": "No FX rate",
  "fx.stale": "FX rate too old",
  threshold: "Above approval limit",
  arithmetic: "Totals don't add up",
  "doc.credit": "Credit note",
  "doc.marketplace": "Marketplace invoice",
};

export async function computeMetrics(orgId: string) {
  const db = getDb();
  const [invoices, decisions, q] = await Promise.all([
    db.select().from(t.invoices).where(eq(t.invoices.orgId, orgId)),
    db.select().from(t.decisions).where(eq(t.decisions.orgId, orgId)),
    queueStats(orgId),
  ]);
  const dmap = new Map(decisions.map((d) => [d.invoiceId, d]));
  const real = invoices.filter((i) => !(i.demoId ?? "").startsWith("seed-"));

  const outcome = { auto_approve: 0, partial_approve: 0, escalate: 0, reject: 0, processing: 0 };
  const money = { cleared: 0, held: 0, blocked: 0 };
  let duplicatesCaught = 0;
  let touchless = 0;
  let waitingForPerson = 0;
  const reasons = new Map<string, number>();
  const bySource = new Map<string, number>();

  for (const inv of real) {
    bySource.set(inv.source, (bySource.get(inv.source) ?? 0) + 1);
    const d = dmap.get(inv.id);
    if (!d) {
      outcome.processing++;
      continue;
    }
    const rec = (d.final ?? d.recommendation) as keyof typeof outcome;
    if (rec in outcome) outcome[rec]++;
    const trace = JSON.parse(d.trace) as PipelineTrace;
    const amount = trace.normalized?.comparableAmount ?? trace.extraction?.total ?? 0;
    if (rec === "auto_approve" || rec === "partial_approve") money.cleared += amount;
    else if (rec === "reject") money.blocked += amount;
    else money.held += amount;
    if (!d.needsHuman) touchless++;
    if (d.needsHuman && !d.final) waitingForPerson++;
    if (trace.duplicates?.length) duplicatesCaught++;
    for (const r of trace.rules ?? []) {
      if (r.outcome === "fail") reasons.set(r.ruleId, (reasons.get(r.ruleId) ?? 0) + 1);
    }
  }

  const decided = real.length - outcome.processing;
  return {
    total: real.length,
    decided,
    outcome,
    money: { cleared: Math.round(money.cleared), held: Math.round(money.held), blocked: Math.round(money.blocked) },
    touchlessRate: decided ? touchless / decided : 0,
    waitingForPerson,
    duplicatesCaught,
    minutesSaved: touchless * MANUAL_MINUTES_PER_INVOICE,
    assumptions: { manualMinutesPerInvoice: MANUAL_MINUTES_PER_INVOICE },
    reasons: [...reasons.entries()]
      .map(([id, count]) => ({ id, label: RULE_LABEL[id] ?? id.replace(/[-_]/g, " "), count }))
      .sort((a, b) => b.count - a.count),
    bySource: Object.fromEntries(bySource),
    queue: q.counts,
  };
}
