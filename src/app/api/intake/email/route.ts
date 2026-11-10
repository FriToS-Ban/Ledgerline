import { NextRequest, NextResponse } from "next/server";
import { ingestRawEmail } from "@/lib/email/ingest";
import { drainQueue } from "@/lib/queue/worker";
import { requireActor } from "@/lib/auth/guard";
import { orgIdBySlug, resolveServiceOrg } from "@/lib/db/org";
import { secretsEqual } from "@/lib/auth/secret";

/**
 * Inbound-email webhook. Accepts either:
 *  - a raw RFC822 body (Content-Type: message/rfc822), or
 *  - multipart/form-data with an `email` field holding the raw message
 *    (SendGrid Inbound Parse "send raw" / Mailgun `message-mime`).
 * Fails closed: with INTAKE_SECRET unset the webhook is disabled (503). The secret goes in the
 * `x-intake-secret` header (constant-time compare). `?secret=` (leaks into URLs and access logs)
 * is accepted only with INTAKE_QUERY_SECRET=1, for providers that can't send headers.
 *
 * The secret authenticates the machine, not a tenant, so the target organization is explicit: the
 * `x-intake-org` header carries its slug (404 if unknown). Without it, SERVICE_ORG_SLUG is used, and
 * only demo / non-production deployments fall back to zamp-demo; otherwise the request is a 400.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INTAKE_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "email intake webhook is disabled: set INTAKE_SECRET" }, { status: 503 });
  }
  const given =
    req.headers.get("x-intake-secret") ??
    (process.env.INTAKE_QUERY_SECRET === "1" ? req.nextUrl.searchParams.get("secret") : null);
  if (!secretsEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const slug = req.headers.get("x-intake-org")?.trim();
  const orgId = slug ? await orgIdBySlug(slug) : await resolveServiceOrg();
  if (!orgId) {
    return slug
      ? NextResponse.json({ error: "unknown organization" }, { status: 404 })
      : NextResponse.json({ error: "x-intake-org header (organization slug) is required" }, { status: 400 });
  }
  const ct = req.headers.get("content-type") ?? "";
  let raw: Uint8Array | null = null;
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const field = form.get("email") ?? form.get("message-mime") ?? form.get("raw");
    if (field instanceof File) raw = new Uint8Array(await field.arrayBuffer());
    else if (typeof field === "string") raw = new TextEncoder().encode(field);
  } else {
    raw = new Uint8Array(await req.arrayBuffer());
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
