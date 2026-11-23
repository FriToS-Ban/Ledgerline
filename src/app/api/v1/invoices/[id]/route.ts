import { NextRequest, NextResponse } from "next/server";
import { apiAuth, apiError, invoiceView, originOf } from "@/lib/api/v1";

/** GET /api/v1/invoices/{id}: status, decision, reasons and payment schedule. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await apiAuth(req);
  if (a.deny) return a.deny;
  const { id } = await ctx.params;
  const v = await invoiceView(a.caller.orgId, id, originOf(req));
  return v ? NextResponse.json(v) : apiError(404, "not_found", "No invoice with that id in this workspace.");
}
