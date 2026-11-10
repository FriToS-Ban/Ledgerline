import { NextRequest, NextResponse } from "next/server";
import { isRealUser, noRealUser, setActiveOrg } from "@/lib/auth/active-org";
import { requireActor } from "@/lib/auth/guard";
import { createOrg } from "@/lib/auth/orgs";
import { readJson } from "@/lib/auth/schemas";
import { listMemberships } from "@/lib/auth/users";

/** The caller's workspaces and which one is active. */
export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const memberships = isRealUser(g.actor) ? await listMemberships(g.actor.userId) : [];
  return NextResponse.json(
    { activeOrgId: g.actor.orgId, memberships: memberships.map((m) => ({ orgId: m.orgId, name: m.name, slug: m.slug, role: m.orgRole })) },
    { headers: { "cache-control": "no-store" } },
  );
}

/** `{ name }` creates a workspace owned by the caller (guard rules and FX seeded) and switches to it. */
export async function POST(req: NextRequest) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  if (!isRealUser(g.actor)) return noRealUser();
  const body = (await readJson(req)) as { name?: unknown };
  const r = await createOrg(g.actor.userId, typeof body.name === "string" ? body.name : "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  await setActiveOrg(r.orgId);
  return NextResponse.json({ org: { orgId: r.orgId, name: r.name, slug: r.slug, role: "owner" } }, { status: 201 });
}
