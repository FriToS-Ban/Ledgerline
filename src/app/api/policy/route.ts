import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { seedOrgDefaults } from "@/lib/db/seed";
import * as t from "@/lib/db/schema";
import { requireActor, requireOrgRole } from "@/lib/auth/guard";

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  await seedOrgDefaults(g.actor.orgId);
  const rows = await getDb().select().from(t.policyRules).where(eq(t.policyRules.orgId, g.actor.orgId));
  return NextResponse.json(rows);
}

export async function PUT(req: NextRequest) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const body = (await req.json()) as { key: string; value: string };
  const updated = await getDb()
    .update(t.policyRules)
    .set({ value: body.value })
    .where(and(eq(t.policyRules.orgId, g.actor.orgId), eq(t.policyRules.key, body.key)))
    .returning({ id: t.policyRules.id });
  if (!updated.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
