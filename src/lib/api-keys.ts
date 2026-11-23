import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

/**
 * Workspace API keys for the agent API (/api/v1). A key can submit invoices and read decisions; it
 * can never release a payment, change policy, or touch the vendor master. Only a sha256 of the key is
 * stored, the key itself is shown once.
 */
const PREFIX = "ll_live_";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(opts: { orgId: string; name: string; createdBy: string }) {
  const name = opts.name.trim().slice(0, 60);
  if (!name) throw new Error("give the key a name, e.g. the system that will use it");
  const active = await getDb()
    .select({ id: t.apiKeys.id })
    .from(t.apiKeys)
    .where(and(eq(t.apiKeys.orgId, opts.orgId), isNull(t.apiKeys.revokedAt)));
  if (active.length >= 20) throw new Error("at most 20 active keys per workspace; revoke an old one first");
  const key = PREFIX + randomBytes(24).toString("base64url");
  const id = randomUUID();
  await getDb()
    .insert(t.apiKeys)
    .values({ orgId: opts.orgId, id, name, prefix: key.slice(0, PREFIX.length + 4), keyHash: hash(key), createdBy: opts.createdBy });
  return { id, name, key, prefix: key.slice(0, PREFIX.length + 4) };
}

export async function listApiKeys(orgId: string) {
  const rows = await getDb().select().from(t.apiKeys).where(eq(t.apiKeys.orgId, orgId)).orderBy(desc(t.apiKeys.createdAt));
  return rows.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdBy: k.createdBy,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeApiKey(orgId: string, id: string) {
  const r = await getDb()
    .update(t.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(t.apiKeys.orgId, orgId), eq(t.apiKeys.id, id), isNull(t.apiKeys.revokedAt)))
    .returning({ id: t.apiKeys.id });
  return r.length === 1;
}

export type ApiCaller = { orgId: string; keyId: string; keyName: string };

/** Resolves `Authorization: Bearer ll_live_…` to its workspace, or null. */
export async function authenticateApiKey(authorization: string | null): Promise<ApiCaller | null> {
  const m = authorization?.match(/^Bearer\s+(ll_live_[A-Za-z0-9_-]{20,64})\s*$/);
  if (!m) return null;
  const db = getDb();
  const [k] = await db.select().from(t.apiKeys).where(and(eq(t.apiKeys.keyHash, hash(m[1])), isNull(t.apiKeys.revokedAt)));
  if (!k) return null;
  // Touch last-used at most once a minute to keep the hot path cheap.
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) {
    await db
      .update(t.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(t.apiKeys.orgId, k.orgId), eq(t.apiKeys.id, k.id)))
      .catch(() => {});
  }
  return { orgId: k.orgId, keyId: k.id, keyName: k.name };
}

/* Per-key rate limit: a fixed one-minute window held in memory (per server instance). */
const windows = new Map<string, { start: number; count: number }>();
export const API_RATE_LIMIT_PER_MIN = Number(process.env.API_RATE_LIMIT_PER_MIN ?? 120);

export function takeRateLimit(keyId: string, now = Date.now()): { ok: boolean; retryAfter: number } {
  const w = windows.get(keyId);
  if (!w || now - w.start >= 60_000) {
    windows.set(keyId, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear();
    return { ok: true, retryAfter: 0 };
  }
  w.count++;
  return w.count <= API_RATE_LIMIT_PER_MIN ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: Math.ceil((w.start + 60_000 - now) / 1000) };
}
