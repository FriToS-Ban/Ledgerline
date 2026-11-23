import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/guard";
import { createBatch, PaymentError } from "@/lib/payments";
import { emitEvent } from "@/lib/webhooks";

/** Owner/admin: put approved invoices into a payment batch (returns the batch; the file is downloaded separately). */
export async function POST(req: NextRequest) {
  const g = await requireOrgRole();
  if (g.deny) return g.deny;
  const body = (await req.json().catch(() => null)) as { invoiceIds?: unknown } | null;
  if (!Array.isArray(body?.invoiceIds)) return NextResponse.json({ error: "invoiceIds must be a list" }, { status: 400 });
  try {
    const b = await createBatch({ orgId: g.actor.orgId, invoiceIds: body.invoiceIds as string[], actorEmail: g.actor.email });
    await emitEvent(g.actor.orgId, "payment_batch.created", {
      batchId: b.id,
      reference: b.reference,
      total: b.total,
      currency: b.currency,
      count: b.count,
    });
    return NextResponse.json({ id: b.id, reference: b.reference, total: b.total, count: b.count, currency: b.currency }, { status: 201 });
  } catch (e) {
    if (e instanceof PaymentError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
