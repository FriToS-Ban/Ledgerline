import { NextRequest, NextResponse } from "next/server";
import { isRealUser, noRealUser } from "@/lib/auth/active-org";
import { requireActor, requireOrgRole } from "@/lib/auth/guard";
import { deleteOrg, getOrg, renameOrg } from "@/lib/auth/orgs";
import { readJson } from "@/lib/auth/schemas";

/** The active workspace, with the caller's role in it. */
export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const org = await getOrg(g.actor.orgId);
  if (!org) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ org: { ...org, role: g.actor.orgRole }, you: { email: g.actor.email } }, { headers: { "cache-control": "no-store" } });
}

/** Owner / admin: `{ name }` renames the active workspace. The slug never changes. */
export async function PATCH(req: NextRequest) {
  const g = await requireOrgRole(["owner", "admin"]);
  if (g.deny) return g.deny;
  const body = (await readJson(req)) as { name?: unknown };
  const r = await renameOrg(g.actor.orgId, typeof body.name === "string" ? body.name : "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ name: r.name });
}

/** Owner only: `{ confirmName }` must equal the workspace name. Deletes every row and file of the workspace. */
export async function DELETE(req: NextRequest) {
  const g = await requireOrgRole(["owner"]);
  if (g.deny) return g.deny;
  if (!isRealUser(g.actor)) return noRealUser();
  const org = await getOrg(g.actor.orgId);
  if (!org) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const { confirmName } = (await readJson(req)) as { confirmName?: unknown };
  if (typeof confirmName !== "string" || confirmName.trim() !== org.name) {
    return NextResponse.json({ error: "Type the workspace name exactly to confirm." }, { status: 400 });
  }
  const r = await deleteOrg(org.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  // The session's active org no longer exists; the next jwt refresh falls back to another membership.
  return NextResponse.json({ ok: true });
}
