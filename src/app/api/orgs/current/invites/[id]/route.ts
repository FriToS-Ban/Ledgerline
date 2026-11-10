import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { revokeInvite } from "@/lib/auth/orgs";

/** Owner / admin: revoke a pending invite of the active workspace. Another workspace's invite id is a 404. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireOrgRole(["owner", "admin"]);
  if (g.deny) return g.deny;
  const { id } = await ctx.params;
  const r = await revokeInvite(g.actor.orgId, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
