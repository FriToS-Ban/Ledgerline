import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { processCase, resumeCase } from "@/lib/process-case";
import type { DemoId } from "@/lib/fixtures/cases";
import type { JobRow } from "./jobs";

function loadBytes(pdfPath: string | null): Uint8Array | undefined {
  // Older rows store /uploads/<file>; newer ones /api/files/<file>. Both live in public/uploads.
  if (!pdfPath || !/^\/(uploads|api\/files)\//.test(pdfPath)) return undefined;
  const file = path.join(process.cwd(), "public", "uploads", path.basename(pdfPath));
  return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : undefined;
}

export async function processInvoiceJob(data: { invoiceId: string; demoId?: string | null; filename?: string }) {
  const [inv] = await getDb().select().from(t.invoices).where(eq(t.invoices.id, data.invoiceId));
  if (!inv) throw new Error(`invoice ${data.invoiceId} not found`);
  // processCase is idempotent: it returns the stored decision if one exists.
  await processCase({
    invoiceId: data.invoiceId,
    demoId: (data.demoId ?? undefined) as DemoId | undefined,
    filename: data.filename,
    pdfBytes: loadBytes(inv.pdfPath),
  });
}

export async function runJob(job: JobRow) {
  const data = JSON.parse(job.payload);
  if (job.kind === "process-invoice") return processInvoiceJob(data);
  if (job.kind === "resume-invoice") {
    await resumeCase(data);
    return;
  }
  throw new Error(`unknown job kind ${job.kind}`);
}
