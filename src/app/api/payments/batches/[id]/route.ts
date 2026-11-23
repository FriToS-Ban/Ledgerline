import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { PaymentError, settleBatch } from "@/lib/payments";
import { emitEvent } from "@/lib/webhooks";

/** Owner/admin: confirm a batch was paid by the bank, or cancel it (its invoices become payable again). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== "paid" && action !== "cancel") return NextResponse.json({ error: 'action must be "paid" or "cancel"' }, { status: 400 });
  try {
    const r = await settleBatch({ orgId: g.actor.orgId, batchId: id, action, actorEmail: g.actor.email });
    await emitEvent(g.actor.orgId, action === "paid" ? "payment_batch.paid" : "payment_batch.cancelled", { batchId: id, ...r });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof PaymentError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
