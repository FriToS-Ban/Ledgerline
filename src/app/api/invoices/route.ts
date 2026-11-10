import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { seedOrgDefaults } from "@/lib/db/seed";
import * as t from "@/lib/db/schema";
import type { PipelineTrace } from "@/lib/invoice/schema";
import { requireActor } from "@/lib/auth/guard";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { orgId } = g.actor;
  await seedOrgDefaults(orgId);
  const db = getDb();
  const invoices = await db.select().from(t.invoices).where(eq(t.invoices.orgId, orgId)).orderBy(desc(t.invoices.createdAt));
  const decisions = await db.select().from(t.decisions).where(eq(t.decisions.orgId, orgId));
  const dmap = new Map(decisions.map((d) => [d.invoiceId, d]));
  return NextResponse.json(
    invoices.map((inv) => {
      const d = dmap.get(inv.id);
      let vendor: string | null = null;
      let reason: string | null = null;
      let amount: number | null = inv.total;
      if (d) {
        try {
          const trace = JSON.parse(d.trace) as PipelineTrace;
          vendor = trace.extraction.vendorName;
          amount = trace.normalized?.comparableAmount ?? trace.extraction.total ?? inv.total;
          reason = trace.rules.find((r) => r.outcome === "fail")?.humanText ?? null;
        } catch {
          /* leave blanks */
        }
      }
      return {
        ...inv,
        vendor,
        reason,
        amount,
        recommendation: d?.recommendation ?? null,
        final: d?.final ?? null,
        confidence: d?.confidence ?? null,
      };
    }),
  );
}
