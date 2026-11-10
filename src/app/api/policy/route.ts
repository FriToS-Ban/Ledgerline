import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { seedOrgDefaults } from "@/lib/db/seed";
import * as t from "@/lib/db/schema";
import { isKnownPolicyKey, OWNER_ONLY_POLICY_KEYS, validatePolicyValue } from "@/lib/policy-keys";
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
  const { actor } = g;
  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!body || typeof body.key !== "string") return NextResponse.json({ error: "key is required" }, { status: 400 });
  if (!isKnownPolicyKey(body.key)) return NextResponse.json({ error: "unknown policy key" }, { status: 400 });
  if (OWNER_ONLY_POLICY_KEYS.has(body.key) && actor.orgRole !== "owner") {
    return NextResponse.json({ error: "requires role: owner to change approval limits and money controls" }, { status: 403 });
  }
  const v = validatePolicyValue(body.key, body.value);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const db = getDb();
  const where = and(eq(t.policyRules.orgId, actor.orgId), eq(t.policyRules.key, body.key));
  const outcome = await db.transaction(async (tx) => {
    const [old] = await tx.select({ value: t.policyRules.value }).from(t.policyRules).where(where).for("update");
    if (!old) return null;
    await tx.update(t.policyRules).set({ value: v.value }).where(where);
    await tx.insert(t.auditEvents).values({
      orgId: actor.orgId,
      id: randomUUID(),
      invoiceId: "policy",
      step: "policy-change",
      status: "success",
      payload: JSON.stringify({ key: body.key, old: old.value, new: v.value, by: `${actor.name} <${actor.email}> (${actor.orgRole})` }),
      at: new Date(),
    });
    return true;
  });
  if (!outcome) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
