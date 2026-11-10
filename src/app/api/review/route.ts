import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { requireActor } from "@/lib/auth/guard";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { orgId } = g.actor;
  const db = getDb();
  const invoices = await db
    .select()
    .from(t.invoices)
    .where(and(eq(t.invoices.orgId, orgId), eq(t.invoices.status, "suspended")));
  const decisions = await db.select().from(t.decisions).where(eq(t.decisions.orgId, orgId)).orderBy(desc(t.decisions.createdAt));
  return NextResponse.json(
    invoices.map((inv) => ({
      invoice: inv,
      decision: decisions.find((d) => d.invoiceId === inv.id) ?? null,
    })),
  );
}
