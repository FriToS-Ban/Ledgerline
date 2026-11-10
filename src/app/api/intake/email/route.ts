import { NextRequest, NextResponse } from "next/server";
import { ingestRawEmail } from "@/lib/email/ingest";
import { drainQueue } from "@/lib/queue/worker";
import { requireActor } from "@/lib/auth/guard";
import { resolveServiceOrg } from "@/lib/db/org";
import { intakeOrgBySlug } from "@/lib/auth/orgs";
import { secretsEqual } from "@/lib/auth/secret";

/** Hard cap on the webhook body (matches the 15 MB attachment limit, plus MIME overhead). */
export const MAX_INTAKE_BYTES = 15 * 1024 * 1024;

/** Reads the body, aborting as soon as it exceeds the cap (also when Content-Length is missing or lies). Null = too large. */
async function readLimited(req: NextRequest): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_INTAKE_BYTES) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_INTAKE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Inbound-email webhook. Accepts either:
 *  - a raw RFC822 body (Content-Type: message/rfc822), or
 *  - multipart/form-data with an `email` field holding the raw message
 *    (SendGrid Inbound Parse "send raw" / Mailgun `message-mime`).
 * The credential goes in the `x-intake-secret` header (constant-time compare; `?secret=` only with
 * INTAKE_QUERY_SECRET=1 for providers that can't send headers) and is one of:
 *  - the per-workspace intake token (an owner creates it via POST /api/orgs/current/intake-token) for the
 *    workspace named by the `x-intake-org` slug header, or
 *  - the deployment-wide INTAKE_SECRET, valid ONLY for the service organization (SERVICE_ORG_SLUG; non-production
 *    / demo deployments fall back to zamp-demo). A leaked global secret therefore cannot write into other tenants.
 * Fails closed: 503 when no credential could possibly be valid (no INTAKE_SECRET and no token for that workspace).
 * Bodies over 15 MB are refused (413) without being read in full.
 */
export async function POST(req: NextRequest) {
  const global = process.env.INTAKE_SECRET?.trim() ?? "";
  const given =
    req.headers.get("x-intake-secret") ??
    (process.env.INTAKE_QUERY_SECRET === "1" ? req.nextUrl.searchParams.get("secret") : null);
  const slug = req.headers.get("x-intake-org")?.trim();
  const globalOk = !!global && secretsEqual(given, global);

  let orgId: string | null = null;
  if (slug) {
    const org = await intakeOrgBySlug(slug, given);
    if (!global && !org?.hasToken) {
      return NextResponse.json({ error: "email intake is disabled for this workspace: create an intake token or set INTAKE_SECRET" }, { status: 503 });
    }
    if (org?.tokenOk) {
      orgId = org.id;
    } else if (globalOk) {
      if (!org) return NextResponse.json({ error: "unknown organization" }, { status: 404 });
      if ((await resolveServiceOrg()) !== org.id) {
        return NextResponse.json({ error: "INTAKE_SECRET is only valid for the service organization; use the workspace's intake token" }, { status: 403 });
      }
      orgId = org.id;
    }
  } else {
    if (!global) {
      return NextResponse.json({ error: "email intake webhook is disabled: set INTAKE_SECRET" }, { status: 503 });
    }
    if (globalOk) {
      orgId = await resolveServiceOrg();
      if (!orgId) return NextResponse.json({ error: "x-intake-org header (organization slug) is required" }, { status: 400 });
    }
  }
  if (!orgId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") ?? "";
  const body = await readLimited(req);
  if (!body) return NextResponse.json({ error: `message too large (max ${MAX_INTAKE_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  let raw: Uint8Array | null = null;
  if (ct.includes("multipart/form-data")) {
    const form = await new Response(body as BodyInit, { headers: { "content-type": ct } }).formData().catch(() => null);
    const field = form?.get("email") ?? form?.get("message-mime") ?? form?.get("raw");
    if (field instanceof File) raw = new Uint8Array(await field.arrayBuffer());
    else if (typeof field === "string") raw = new TextEncoder().encode(field);
  } else {
    raw = body;
  }
  if (!raw || raw.length === 0) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const result = await ingestRawEmail(orgId, raw, "webhook");
  // Don't block the sender's webhook on processing; the worker picks the jobs up.
  void drainQueue(50, orgId);
  return NextResponse.json(result, { status: result.status === "ingested" ? 202 : 200 });
}

export async function GET() {
  const g = await requireActor();
  if (g.deny) return g.deny;
  const { desc, eq } = await import("drizzle-orm");
  const { getDb } = await import("@/lib/db/client");
  const t = await import("@/lib/db/schema");
  const rows = await getDb().select().from(t.emailMessages).where(eq(t.emailMessages.orgId, g.actor.orgId)).orderBy(desc(t.emailMessages.receivedAt)).limit(25);
  const { imapConfigured } = await import("@/lib/email/imap");
  return NextResponse.json({ imap: imapConfigured(), emails: rows });
}
