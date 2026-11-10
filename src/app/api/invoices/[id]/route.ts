import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { seedDatabase } from "@/lib/db/seed";
import * as t from "@/lib/db/schema";
import { requireSignedIn } from "@/lib/auth/users";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  await seedDatabase();
  const { id } = await ctx.params;
  const db = getDb();
  const [invoice] = await db.select().from(t.invoices).where(eq(t.invoices.id, id));
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [decision] = await db.select().from(t.decisions).where(eq(t.decisions.invoiceId, id));
  const events = await db
    .select()
    .from(t.auditEvents)
    .where(eq(t.auditEvents.invoiceId, id))
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
