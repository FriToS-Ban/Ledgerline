import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { createInvite, listInvites } from "@/lib/auth/orgs";
import { readJson } from "@/lib/auth/schemas";
import type { OrgRole } from "@/lib/auth/users";

/** Owner / admin: pending invites of the active workspace (never the tokens, which are stored hashed). */
export async function GET() {
  const g = await requireOrgRole(["owner", "admin"]);
  if (g.deny) return g.deny;
  return NextResponse.json({ invites: await listInvites(g.actor.orgId) }, { headers: { "cache-control": "no-store" } });
}

/** Owner / admin: `{ email, role }` creates a 7-day, single-use invite. The raw token is in this response only. */
export async function POST(req: NextRequest) {
  const g = await requireOrgRole(["owner", "admin"]);
  if (g.deny) return g.deny;
  const body = (await readJson(req)) as { email?: unknown; role?: unknown };
  const r = await createInvite(g.actor.orgId, g.actor.orgRole, String(body.email ?? ""), String(body.role ?? "member") as OrgRole);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ invite: r.invite, path: `/invite/${r.token}` }, { status: 201, headers: { "cache-control": "no-store" } });
}
