import { requireOrgRole } from "@/lib/auth/guard";
import { batchFile } from "@/lib/payments";

/** The exact bank upload file of a batch. Contains full account numbers: owner/admin only, never cached. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const { id } = await ctx.params;
  const b = await batchFile(g.actor.orgId, id);
  if (!b) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(b.file, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${b.reference}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
