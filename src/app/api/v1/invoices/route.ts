import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { seedOrgDefaults } from "@/lib/db/seed";
import { createInvoiceRecord } from "@/lib/process-case";
import { saveUpload, UploadRejected } from "@/lib/extract/save-upload";
import { enqueue } from "@/lib/queue/jobs";
import { drainQueue } from "@/lib/queue/worker";
import { apiAuth, apiError, invoiceView, listInvoiceViews, originOf, submitSchema, toExtraction } from "@/lib/api/v1";

export const maxDuration = 60;

/** GET /api/v1/invoices?limit=25: newest first. */
export async function GET(req: NextRequest) {
  const a = await apiAuth(req);
  if (a.deny) return a.deny;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 25);
  const data = await listInvoiceViews(a.caller.orgId, originOf(req), Number.isFinite(limit) ? limit : 25);
  return NextResponse.json({ object: "list", data });
}

/**
 * POST /api/v1/invoices: submit an invoice and get the guard's decision.
 *  - multipart/form-data with `file` (PDF or image) and optional `externalId`, or
 *  - application/json with the fields your agent already extracted (see /api/v1/openapi.json).
 * Answers 201 with the decision when it is ready within the request, else 202 + Location to poll.
 */
export async function POST(req: NextRequest) {
  const a = await apiAuth(req);
  if (a.deny) return a.deny;
  const { orgId, keyName } = a.caller;
  await seedOrgDefaults(orgId);
  const invoiceId = randomUUID();
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return apiError(400, "file_required", "Send the invoice as a multipart field named `file`.");
    const externalId = String(form?.get("externalId") ?? "").slice(0, 100) || null;
    let pdfPath: string;
    try {
      pdfPath = await saveUpload({ orgId, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch (e) {
      if (e instanceof UploadRejected) return apiError(e.status, "upload_rejected", e.message);
      console.error("api upload storage failed", e);
      return apiError(503, "storage_unavailable", "File storage is unavailable; retry shortly.");
    }
    await createInvoiceRecord({ orgId, id: invoiceId, filename: file.name, runId: randomUUID(), pdfPath, source: "api", sender: `api:${keyName}`, subject: externalId });
    await enqueue(orgId, "process-invoice", { invoiceId, filename: file.name });
  } else if (contentType.includes("application/json")) {
    const parsed = submitSchema.safeParse(await req.json().catch(() => undefined));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "The invoice fields are not valid.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
        { status: 400 },
      );
    }
    await createInvoiceRecord({ orgId, id: invoiceId, runId: randomUUID(), source: "api", sender: `api:${keyName}`, subject: parsed.data.externalId ?? null });
    await enqueue(orgId, "process-invoice", { invoiceId, extraction: toExtraction(parsed.data) });
  } else {
    return apiError(415, "unsupported_media_type", "Use multipart/form-data (file upload) or application/json (extracted fields).");
  }

  await drainQueue(50, orgId);
  const origin = originOf(req);
  const body = await invoiceView(orgId, invoiceId, origin);
  const location = `${origin}/api/v1/invoices/${invoiceId}`;
  return NextResponse.json(body, { status: body?.decision ? 201 : 202, headers: { Location: location } });
}
