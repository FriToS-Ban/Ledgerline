import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { resumeCase, ResumeError } from "@/lib/process-case";
import { approvalLimit } from "@/lib/auth/users";
import { isOrgAdmin, requireActor } from "@/lib/auth/guard";
import type { PipelineTrace } from "@/lib/invoice/schema";

export async function POST(req: NextRequest) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { actor } = g;

  const body = (await req.json()) as {
    invoiceId: string;
    action: "approve" | "reject" | "override";
    override?: string;
    note?: string;
  };
  if (typeof body.invoiceId !== "string") return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });

  const [d] = await getDb()
    .select()
    .from(t.decisions)
    .where(and(eq(t.decisions.orgId, actor.orgId), eq(t.decisions.invoiceId, body.invoiceId)));
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Anyone in the org may stop a payment; releasing money needs an owner or admin, capped by their limit.
  const releasing = body.action !== "reject" && body.override !== "reject";
  if (releasing) {
    if (!isOrgAdmin(actor.orgRole)) {
      return NextResponse.json({ error: "requires role: owner or admin to release a payment", code: "not-approver" }, { status: 403 });
    }
    const trace = JSON.parse(d.trace) as PipelineTrace;
    const rawAmount = trace.normalized?.comparableAmount ?? trace.extraction.total;
    const amount = typeof rawAmount === "number" ? rawAmount : NaN;
    const limit = await approvalLimit(actor.orgId, actor.orgRole);
    // An unknown / non-finite amount can't be shown to be under the limit, so only an owner may release it.
    if (actor.orgRole !== "owner" && (!Number.isFinite(amount) || amount > limit)) {
      return NextResponse.json(
        {
          error: `This invoice is ${Number.isFinite(amount) ? amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "of unknown value (treated as over the limit)"}, above the ${actor.orgRole} approval limit of ${limit.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}. A more senior approver must release it.`,
          code: "over-limit",
        },
        { status: 403 },
      );
    }
  }
  try {
    const result = await resumeCase({
      orgId: actor.orgId,
      invoiceId: body.invoiceId,
      action: body.action,
      override: body.override,
      note: body.note,
      by: `${actor.name} <${actor.email}> (${actor.orgRole})`,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ResumeError) {
      const status = e.kind === "already-final" ? 409 : e.kind === "invalid" ? 400 : 404;
      return NextResponse.json({ error: e.message }, { status });
    }
    throw e;
  }
}
