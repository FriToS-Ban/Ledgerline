import { NextRequest, NextResponse } from "next/server";
import { ingestRawEmail } from "@/lib/email/ingest";
import { drainQueue } from "@/lib/queue/worker";
import { requireSignedIn } from "@/lib/auth/users";
import { secretsEqual } from "@/lib/auth/secret";

/**
 * Inbound-email webhook. Accepts either:
 *  - a raw RFC822 body (Content-Type: message/rfc822), or
 *  - multipart/form-data with an `email` field holding the raw message
 *    (SendGrid Inbound Parse "send raw" / Mailgun `message-mime`).
 * Fails closed: with INTAKE_SECRET unset the webhook is disabled (503). The secret goes in the
 * `x-intake-secret` header (constant-time compare). `?secret=` (leaks into URLs and access logs)
 * is accepted only with INTAKE_QUERY_SECRET=1, for providers that can't send headers.
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

  const result = await ingestRawEmail(raw, "webhook");
  // Don't block the sender's webhook on processing; the worker picks the jobs up.
  void drainQueue();
  return NextResponse.json(result, { status: result.status === "ingested" ? 202 : 200 });
}

export async function GET() {
  const unauth = await requireSignedIn();
  if (unauth) return unauth;
  const { desc } = await import("drizzle-orm");
  const { getDb } = await import("@/lib/db/client");
  const t = await import("@/lib/db/schema");
  const rows = await getDb().select().from(t.emailMessages).orderBy(desc(t.emailMessages.receivedAt)).limit(25);
  const { imapConfigured } = await import("@/lib/email/imap");
  return NextResponse.json({ imap: imapConfigured(), emails: rows });
}
