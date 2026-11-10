import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { PipelineTrace } from "@/lib/invoice/schema";

type Truth = { vendor: string; invoiceNumber: string | null; total: number | null; poNumbers: string[] };

export async function computeAccuracy() {
  const db = getDb();
  const [cases, decisions] = await Promise.all([db.select().from(t.evalCases), db.select().from(t.decisions)]);
  const dmap = new Map(decisions.map((d) => [d.invoiceId, d]));

  const fields = { vendor: [0, 0], invoiceNumber: [0, 0], total: [0, 0], poNumbers: [0, 0] } as Record<string, [number, number]>;
  const scenarios = new Map<string, { scenario: string; total: number; correct: number; wronglyPaid: number }>();
  const misses: { invoiceId: string; scenario: string; expected: string[]; actual: string; note: string }[] = [];
  let scored = 0;
  let correct = 0;
  let wronglyPaid = 0;
  let sentToHuman = 0;

  for (const c of cases) {
    const d = dmap.get(c.invoiceId);
    if (!d) continue;
    scored++;
    const expected = JSON.parse(c.expected) as string[];
    const truth = JSON.parse(c.truth) as Truth;
    const trace = JSON.parse(d.trace) as PipelineTrace;
    const actual = d.recommendation;
    const ok = expected.includes(actual);
    const paidWrongly = actual === "auto_approve" && !expected.includes("auto_approve");
    if (ok) correct++;
    if (paidWrongly) wronglyPaid++;
    if (d.needsHuman) sentToHuman++;

    const s = scenarios.get(c.scenario) ?? { scenario: c.scenario, total: 0, correct: 0, wronglyPaid: 0 };
    s.total++;
    if (ok) s.correct++;
    if (paidWrongly) s.wronglyPaid++;
    scenarios.set(c.scenario, s);
    if (!ok) {
      misses.push({
        invoiceId: c.invoiceId,
        scenario: c.scenario,
        expected,
        actual,
        note: paidWrongly ? "Would have been paid — unsafe" : "Different call than expected",
      });
    }

    const x = trace.extraction;
    const tally = (k: string, pass: boolean) => {
      fields[k][1]++;
      if (pass) fields[k][0]++;
    };
    tally("vendor", x.vendorName === truth.vendor);
    tally("invoiceNumber", (x.invoiceNumber ?? null) === truth.invoiceNumber);
    tally("total", (x.total ?? null) === truth.total);
    tally("poNumbers", [...(x.poNumbers ?? [])].sort().join(",") === [...truth.poNumbers].sort().join(","));
  }

  const pct = (a: number, b: number) => (b ? a / b : 0);
  return {
    scored,
    pending: cases.length - scored,
    decisionAccuracy: pct(correct, scored),
    correct,
    wronglyPaid,
    sentToHuman,
    extraction: Object.entries(fields).map(([field, [ok, n]]) => ({ field, correct: ok, total: n, rate: pct(ok, n) })),
    scenarios: [...scenarios.values()],
    misses,
  };
}
