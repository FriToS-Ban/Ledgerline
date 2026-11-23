import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { revokeApiKey } from "@/lib/api-keys";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const { id } = await ctx.params;
  return (await revokeApiKey(g.actor.orgId, id))
    ? NextResponse.json({ revoked: true })
    : NextResponse.json({ error: "no active key with that id" }, { status: 404 });
}
