import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { requireActor } from "@/lib/auth/guard";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { orgId } = g.actor;
  const { id } = await ctx.params;
  const db = getDb();
  const [invoice] = await db.select().from(t.invoices).where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.id, id)));
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [decision] = await db.select().from(t.decisions).where(and(eq(t.decisions.orgId, orgId), eq(t.decisions.invoiceId, id)));
  const events = await db
    .select()
    .from(t.auditEvents)
    .where(and(eq(t.auditEvents.orgId, orgId), eq(t.auditEvents.invoiceId, id)))
    .orderBy(desc(t.auditEvents.at));
  events.reverse();
  return NextResponse.json({
    invoice,
    decision: decision
      ? { ...decision, trace: JSON.parse(decision.trace) }
      : null,
    events: events.map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
  });
}
