import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { deleteWebhook } from "@/lib/webhooks";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const { id } = await ctx.params;
  return (await deleteWebhook(g.actor.orgId, id))
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: "no webhook with that id" }, { status: 404 });
}
