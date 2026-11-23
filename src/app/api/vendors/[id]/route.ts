import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { updateVendor, VendorPatchError, type VendorPatch } from "@/lib/vendors";

/** Owner/admin edit of the vendor master. Bank-detail changes are owner-only and audited. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as VendorPatch | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  try {
    const r = await updateVendor({ orgId: g.actor.orgId, vendorId: id, patch: body, actor: g.actor });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof VendorPatchError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
