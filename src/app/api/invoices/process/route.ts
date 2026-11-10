import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { seedDatabase } from "@/lib/db/seed";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { createInvoiceRecord } from "@/lib/process-case";
import { saveUpload } from "@/lib/extract/save-upload";
import { enqueue } from "@/lib/queue/jobs";
import { drainQueue } from "@/lib/queue/worker";
import type { DemoId } from "@/lib/fixtures/cases";
import { requireSignedIn } from "@/lib/auth/guard";

export async function POST(req: NextRequest) {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  await seedDatabase();
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

  const runId = randomUUID();
  const invoiceId = randomUUID();
  const pdfPath = pdfBytes ? saveUpload({ invoiceId, filename, bytes: pdfBytes }) : undefined;
  await createInvoiceRecord({ id: invoiceId, demoId, filename, runId, pdfPath });

  // Durable path: the job row survives a crash and is retried with backoff.
  // We then drain inline so the UI usually gets the result straight away.
  const jobId = await enqueue("process-invoice", { invoiceId, demoId, filename });
  await drainQueue();

  const db = getDb();
  const [decision] = await db.select().from(t.decisions).where(eq(t.decisions.invoiceId, invoiceId));
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
