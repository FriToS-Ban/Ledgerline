import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { processCase, resumeCase, ResumeError } from "@/lib/process-case";
import type { DemoId } from "@/lib/fixtures/cases";
import type { JobRow } from "./jobs";
import { getStorage, keyBelongsToOrg, readAll } from "@/lib/storage";

async function loadBytes(orgId: string, pdfPath: string | null): Promise<Uint8Array | undefined> {
  // Uploaded files are storage keys under org/<orgId>/; demo fixtures (/demos/...) are not stored.
  if (!pdfPath || !keyBelongsToOrg(pdfPath, orgId)) return undefined;
  const stream = await getStorage().get(pdfPath);
  return stream ? readAll(stream) : undefined;
}

export async function processInvoiceJob(data: { orgId: string; invoiceId: string; demoId?: string | null; filename?: string }) {
  const [inv] = await getDb()
    .select()
    .from(t.invoices)
    .where(and(eq(t.invoices.orgId, data.orgId), eq(t.invoices.id, data.invoiceId)));
  if (!inv) throw new Error(`invoice ${data.invoiceId} not found`);
  // processCase is idempotent: it returns the stored decision if one exists.
  await processCase({
    orgId: data.orgId,
    invoiceId: data.invoiceId,
    demoId: (data.demoId ?? undefined) as DemoId | undefined,
    filename: data.filename,
    pdfBytes: await loadBytes(data.orgId, inv.pdfPath),
  });
}

export async function runJob(job: JobRow) {
  // The job row is the authority on tenancy: whatever the payload says, the job runs as its own org.
  const data = { ...JSON.parse(job.payload), orgId: job.orgId };
  if (job.kind === "process-invoice") return processInvoiceJob(data);
  if (job.kind === "resume-invoice") {
    try {
      await resumeCase(data);
    } catch (e) {
      if (e instanceof ResumeError && e.kind === "already-final") return; // a retried job must not fail the queue
      throw e;
    }
    return;
  }
  throw new Error(`unknown job kind ${job.kind}`);
}
