import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { resumeCase } from "@/lib/process-case";
import { approvalLimit, getActor } from "@/lib/auth/users";
import type { PipelineTrace } from "@/lib/invoice/schema";

export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const body = (await req.json()) as {
    invoiceId: string;
    action: "approve" | "reject" | "override";
    override?: string;
    note?: string;
  };

  // Approval limits: anyone may stop a payment, but releasing money is capped by role.
  const releasing = body.action !== "reject" && body.override !== "reject";
  if (releasing) {
    const [d] = await getDb().select().from(t.decisions).where(eq(t.decisions.invoiceId, body.invoiceId));
    if (d) {
      const trace = JSON.parse(d.trace) as PipelineTrace;
      const amount = trace.normalized?.comparableAmount ?? trace.extraction.total ?? 0;
      const limit = await approvalLimit(actor.role);
      if (amount > limit) {
        return NextResponse.json(
          {
            error: `This invoice is ${amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}, above the ${actor.role} approval limit of ${limit.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}. A more senior approver must release it.`,
            code: "over-limit",
          },
          { status: 403 },
        );
      }
    }
  }
  const result = await resumeCase({ ...body, by: `${actor.name} <${actor.email}> (${actor.role})` });
  return NextResponse.json(result);
}
