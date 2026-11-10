import { NextRequest, NextResponse } from "next/server";
import { readJson, roleChangeSchema, validationError } from "@/lib/auth/schemas";
import { requireOrgRole } from "@/lib/auth/guard";
import { changeMemberRole, listOrgMembers } from "@/lib/auth/users";

/** Owner / admin only: the members of the caller's organization with their org role. */
export async function GET() {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  return NextResponse.json({ users: await listOrgMembers(g.actor.orgId) }, { headers: { "cache-control": "no-store" } });
}

/** Owner / admin only: `{ email, role }` sets that member's org role. Demoting the last owner is refused (409). */
export async function PATCH(req: NextRequest) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const parsed = roleChangeSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const r = await changeMemberRole(g.actor.orgId, g.actor.orgRole, parsed.data.email, parsed.data.role);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ user: r.user });
}
