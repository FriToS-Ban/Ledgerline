import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { authSecret } from "@/lib/auth/secret";
import { enqueue } from "@/lib/queue/jobs";

export const WEBHOOK_EVENTS = [
  "invoice.decided",
  "invoice.resolved",
  "payment_batch.created",
  "payment_batch.paid",
  "payment_batch.cancelled",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/* ------------------------------------------------------------ secret at rest */

function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret(), "ledgerline-webhooks", "signing-secret-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, enc] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("unreadable webhook secret");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

/* --------------------------------------------------------------- SSRF guard */

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224
  );
}

const allowPrivate = () => process.env.NODE_ENV !== "production" && process.env.WEBHOOK_ALLOW_PRIVATE === "1";

/** Throws unless `raw` is an https URL whose host resolves only to public addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("not a valid URL");
  }
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) throw new Error("webhook URL must use https://");
  if (u.username || u.password) throw new Error("webhook URL must not contain credentials");
  if (allowPrivate()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error("webhook URL must be a public host");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addrs.length) throw new Error("webhook host does not resolve");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("webhook URL must not point to a private network address");
  return u;
}

/* ----------------------------------------------------------------- registry */

export async function createWebhook(opts: { orgId: string; url: string; events?: string[]; createdBy: string }) {
  const url = (await assertPublicUrl(opts.url.trim())).toString();
  const events = (opts.events ?? []).filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  const existing = await getDb().select({ id: t.webhooks.id }).from(t.webhooks).where(eq(t.webhooks.orgId, opts.orgId));
  if (existing.length >= 10) throw new Error("at most 10 webhooks per workspace");
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const id = randomUUID();
  await getDb()
    .insert(t.webhooks)
    .values({
      orgId: opts.orgId,
      id,
      url,
      secretEnc: encryptSecret(secret),
      events: events.length ? events.join(",") : "*",
      createdBy: opts.createdBy,
    });
  return { id, url, events: events.length ? events : ["*"], secret };
}

export async function listWebhooks(orgId: string) {
  const db = getDb();
  const hooks = await db.select().from(t.webhooks).where(eq(t.webhooks.orgId, orgId)).orderBy(desc(t.webhooks.createdAt));
  const deliveries = await db
    .select()
    .from(t.webhookDeliveries)
    .where(eq(t.webhookDeliveries.orgId, orgId))
    .orderBy(desc(t.webhookDeliveries.createdAt))
    .limit(20);
  return {
    webhooks: hooks.map((h) => ({
      id: h.id,
      url: h.url,
      events: h.events.split(","),
      active: h.active,
      createdAt: h.createdAt.toISOString(),
      lastStatus: h.lastStatus,
      lastDeliveryAt: h.lastDeliveryAt?.toISOString() ?? null,
    })),
    deliveries: deliveries.map((d) => ({
      id: d.id,
      webhookId: d.webhookId,
      event: d.event,
      statusCode: d.statusCode,
      error: d.error,
      attempts: d.attempts,
      createdAt: d.createdAt.toISOString(),
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
    })),
  };
}

export async function deleteWebhook(orgId: string, id: string) {
  const r = await getDb()
    .delete(t.webhooks)
    .where(and(eq(t.webhooks.orgId, orgId), eq(t.webhooks.id, id)))
    .returning({ id: t.webhooks.id });
  return r.length === 1;
}

/* ----------------------------------------------------------------- delivery */

/** `Ledgerline-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (verify in constant time). */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/**
 * Records one delivery per subscribed webhook and queues it. The queue retries failures with
 * exponential backoff, so a receiver that is down for a few minutes still gets every event.
 */
export async function emitEvent(orgId: string, event: WebhookEvent, data: Record<string, unknown>) {
  try {
    const hooks = await getDb()
      .select()
      .from(t.webhooks)
      .where(and(eq(t.webhooks.orgId, orgId), eq(t.webhooks.active, true)));
    const subscribed = hooks.filter((h) => h.events === "*" || h.events.split(",").includes(event));
    for (const h of subscribed) {
      const id = randomUUID();
      const payload = JSON.stringify({ id, type: event, createdAt: new Date().toISOString(), data });
      await getDb().insert(t.webhookDeliveries).values({ orgId, id, webhookId: h.id, event, payload });
      await enqueue(orgId, "deliver-webhook", { deliveryId: id }, { maxAttempts: 6 });
    }
    return subscribed.length;
  } catch (err) {
    // A webhook problem must never fail the invoice or payment it reports on.
    console.error("[webhooks] could not queue event", event, err);
    return 0;
  }
}

/** Sends one queued delivery. Throws on failure so the job queue retries it. */
export async function deliverWebhook(orgId: string, deliveryId: string) {
  const db = getDb();
  const [d] = await db
    .select()
    .from(t.webhookDeliveries)
    .where(and(eq(t.webhookDeliveries.orgId, orgId), eq(t.webhookDeliveries.id, deliveryId)));
  if (!d || d.deliveredAt) return;
  const [h] = await db.select().from(t.webhooks).where(and(eq(t.webhooks.orgId, orgId), eq(t.webhooks.id, d.webhookId)));
  if (!h || !h.active) return; // deleted or paused: drop silently

  const attempts = d.attempts + 1;
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const url = await assertPublicUrl(h.url); // re-checked at send time (DNS can change)
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual", // a redirect could point at a private address
      signal: AbortSignal.timeout(8_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "Ledgerline-Webhooks/1.0",
        "ledgerline-event": d.event,
        "ledgerline-delivery": d.id,
        "ledgerline-signature": signPayload(decryptSecret(h.secretEnc), d.payload, ts),
      },
      body: d.payload,
    });
    statusCode = res.status;
    if (res.status < 200 || res.status >= 300) error = `receiver answered ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const now = new Date();
  await db
    .update(t.webhookDeliveries)
    .set({ attempts, statusCode, error, deliveredAt: error ? null : now })
    .where(and(eq(t.webhookDeliveries.orgId, orgId), eq(t.webhookDeliveries.id, d.id)));
  await db
    .update(t.webhooks)
    .set({ lastStatus: statusCode ?? 0, lastDeliveryAt: now })
    .where(and(eq(t.webhooks.orgId, orgId), eq(t.webhooks.id, h.id)));
  if (error) throw new Error(`webhook delivery failed: ${error}`);
}
