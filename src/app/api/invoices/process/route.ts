import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { seedDatabase, seedOrgDefaults } from "@/lib/db/seed";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { createInvoiceRecord } from "@/lib/process-case";
import { saveUpload, UploadRejected } from "@/lib/extract/save-upload";
import { enqueue } from "@/lib/queue/jobs";
import { drainQueue } from "@/lib/queue/worker";
import type { DemoId } from "@/lib/fixtures/cases";
import { requireActor } from "@/lib/auth/guard";

export async function POST(req: NextRequest) {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { orgId } = g.actor;
  await seedOrgDefaults(orgId);
  const contentType = req.headers.get("content-type") ?? "";
  let demoId: DemoId | undefined;
  let filename: string | undefined;
  let pdfBytes: Uint8Array | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    demoId = (form.get("demoId") as DemoId) || undefined;
    const file = form.get("file");
    if (file instanceof File) {
      filename = file.name;
      pdfBytes = new Uint8Array(await file.arrayBuffer());
    }
  } else {
    const body = (await req.json()) as { demoId?: DemoId };
    demoId = body.demoId;
  }

  // A demo case needs the demo vendor/PO book: seed it into an empty workspace, or top up an older
  // demo workspace with vendors/POs added since. A workspace with its own (non-demo) vendors is untouched.
  if (demoId) await seedDatabase(orgId, { pdfs: false });

  const runId = randomUUID();
  const invoiceId = randomUUID();
  let pdfPath: string | undefined;
  try {
    pdfPath = pdfBytes ? await saveUpload({ orgId, filename, bytes: pdfBytes }) : undefined;
  } catch (e) {
    if (e instanceof UploadRejected) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("upload storage failed", e);
    return NextResponse.json({ error: "File storage is unavailable right now. Please try again shortly." }, { status: 503 });
  }
  await createInvoiceRecord({ orgId, id: invoiceId, demoId, filename, runId, pdfPath });

  // Durable path: the job row survives a crash and is retried with backoff.
  // We then drain inline so the UI usually gets the result straight away.
  const jobId = await enqueue(orgId, "process-invoice", { invoiceId, demoId, filename });
  await drainQueue(50, orgId);

  const db = getDb();
  const [decision] = await db.select().from(t.decisions).where(and(eq(t.decisions.orgId, orgId), eq(t.decisions.invoiceId, invoiceId)));
  return NextResponse.json({
    invoiceId,
    runId,
    jobId,
    via: "queue",
    pending: !decision,
    needsHuman: decision ? decision.needsHuman && !decision.final : null,
    recommendation: decision?.recommendation ?? null,
  });
}
