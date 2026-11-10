import { rawDbClient } from "@/lib/db/client";
import { ensureAuthSchema } from "./db";
import {
  ABSOLUTE_TTL_MS,
  createToken,
  hashSessionId,
  IDLE_TTL_MS,
  isRole,
  newSessionId,
  readToken,
  type Role,
} from "./session";

export type Actor = { email: string; name: string; role: Role };

/** Only write last_seen_at when it is this stale, so a busy page doesn't write on every request. */
const TOUCH_EVERY_MS = 60 * 1000;

/** Starts a session: stores sha256(id) and returns the signed cookie value. */
export async function createSession(user: Actor, meta: { ip?: string; userAgent?: string } = {}) {
  await ensureAuthSchema();
  const sid = newSessionId();
  const now = Date.now();
  const expiresAt = now + ABSOLUTE_TTL_MS;
  await rawDbClient().execute({
    sql: `INSERT INTO auth_sessions (id_hash, email, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    args: [hashSessionId(sid), user.email, now, now, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null],
  });
  return { token: createToken({ ...user, sid }, expiresAt), sid, expiresAt };
}

/**
 * Turns a cookie value into the current user, or null. Checks, in order: HMAC signature and
 * absolute expiry (readToken), a live DB row for sha256(sid) that is not revoked, not past its
 * absolute expiry and not idle longer than IDLE_TTL_MS; then reads name/role fresh from the users
 * table so role changes take effect immediately. Slides the idle window.
 */
export async function resolveSession(token: string | null | undefined): Promise<(Actor & { sid: string }) | null> {
  const t = readToken(token);
  if (!t?.sid) return null;
  await ensureAuthSchema();
  const db = rawDbClient();
  const now = Date.now();
  const row = (
    await db.execute({
      sql: `SELECT s.last_seen_at, s.expires_at, s.revoked_at, u.email, u.name, u.role
            FROM auth_sessions s JOIN users u ON u.email = s.email WHERE s.id_hash = ?`,
      args: [hashSessionId(t.sid)],
    })
  ).rows[0];
  if (!row || row.revoked_at != null) return null;
  const lastSeen = Number(row.last_seen_at);
  if (Number(row.expires_at) <= now || now - lastSeen > IDLE_TTL_MS) return null;
  if (!isRole(row.role)) return null;
  if (now - lastSeen > TOUCH_EVERY_MS) {
    await db.execute({ sql: "UPDATE auth_sessions SET last_seen_at = ? WHERE id_hash = ?", args: [now, hashSessionId(t.sid)] });
  }
  return { sid: t.sid, email: String(row.email), name: String(row.name), role: row.role };
}

/** Revokes one session by its raw id. */
export async function revokeSession(sid: string) {
  await ensureAuthSchema();
  await rawDbClient().execute({
    sql: "UPDATE auth_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL",
    args: [Date.now(), hashSessionId(sid)],
  });
}

/** Revokes every live session of a user, optionally keeping one (the caller's). Returns how many. */
export async function revokeUserSessions(email: string, exceptSid?: string): Promise<number> {
  await ensureAuthSchema();
  const r = await rawDbClient().execute({
    sql: `UPDATE auth_sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL AND id_hash != ?`,
    args: [Date.now(), email, exceptSid ? hashSessionId(exceptSid) : ""],
  });
  // Housekeeping: forget sessions that ended more than a day ago.
  await rawDbClient().execute({
    sql: "DELETE FROM auth_sessions WHERE expires_at < ?",
    args: [Date.now() - 24 * 60 * 60 * 1000],
  });
  return r.rowsAffected;
}

/** Live (unrevoked, unexpired) session count for a user. */
export async function activeSessionCount(email: string): Promise<number> {
  await ensureAuthSchema();
  const now = Date.now();
  const r = await rawDbClient().execute({
    sql: "SELECT COUNT(*) c FROM auth_sessions WHERE email = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen_at > ?",
    args: [email, now, now - IDLE_TTL_MS],
  });
  return Number(r.rows[0].c);
}
