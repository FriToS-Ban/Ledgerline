import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { revokeIntakeToken, rotateIntakeToken } from "@/lib/auth/orgs";

/** Owner only: creates or rotates this workspace's email-intake token. Shown once; only its hash is stored. */
export async function POST() {
  const g = await requireOrgRole(["owner"]);
  if (g.deny) return g.deny;
  const token = await rotateIntakeToken(g.actor.orgId);
  return NextResponse.json({ token }, { status: 201, headers: { "cache-control": "no-store" } });
}

/** Owner only: revokes the token (the intake webhook then refuses this workspace). */
export async function DELETE() {
  const g = await requireOrgRole(["owner"]);
  if (g.deny) return g.deny;
  await revokeIntakeToken(g.actor.orgId);
  return NextResponse.json({ ok: true });
}
