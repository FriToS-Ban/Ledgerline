import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import type { PipelineTrace } from "@/lib/invoice/schema";
import { requireActor } from "@/lib/auth/guard";

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Controller-ready audit trail for one invoice: ?format=json (default) or csv. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { orgId } = g.actor;
  const { id } = await ctx.params;
  const db = getDb();
  const [invoice] = await db.select().from(t.invoices).where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.id, id)));
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [decision] = await db.select().from(t.decisions).where(and(eq(t.decisions.orgId, orgId), eq(t.decisions.invoiceId, id)));
  const events = await db.select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, orgId), eq(t.auditEvents.invoiceId, id))).orderBy(asc(t.auditEvents.at));
  const trace = decision ? (JSON.parse(decision.trace) as PipelineTrace) : null;
  const review = events.filter((e) => e.step === "review" && e.status === "success").map((e) => JSON.parse(e.payload));

  const summary = {
    invoiceId: id,
    source: invoice.source,
    sender: invoice.sender,
    subject: invoice.subject,
    receivedAt: invoice.createdAt,
    vendor: trace?.extraction.vendorName ?? null,
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.total,
    currency: invoice.currency,
    engineRecommendation: decision?.recommendation ?? null,
    finalDecision: decision?.final ?? null,
    confidence: decision?.confidence ?? null,
    explanation: decision?.explanation ?? null,
    humanReview: review,
    checks: (trace?.rules ?? []).map((r) => ({ rule: r.ruleId, outcome: r.outcome, detail: r.humanText })),
    note: "The pay/hold decision is made by deterministic rules; any AI-written memo is commentary only.",
  };

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const rows = [
      ["section", "item", "status", "detail", "timestamp"],
      ["summary", "decision", summary.finalDecision ?? summary.engineRecommendation ?? "pending", summary.explanation, invoice.createdAt],
      ...summary.checks.map((c) => ["check", c.rule, c.outcome, c.detail, ""]),
      ...events.map((e) => ["event", e.step, e.status, e.payload.slice(0, 500), e.at]),
    ];
    return new NextResponse(rows.map((r) => r.map(q).join(",")).join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${id.slice(0, 8)}.csv"`,
      },
    });
  }
  return NextResponse.json({ ...summary, events: events.map((e) => ({ ...e, payload: JSON.parse(e.payload) })) });
}
