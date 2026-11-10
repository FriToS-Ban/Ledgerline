import { query } from "@/lib/db/client";
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
  const sid = newSessionId();
  const now = Date.now();
  const expiresAt = now + ABSOLUTE_TTL_MS;
  await query(
    `INSERT INTO auth_sessions (id_hash, email, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent)
     VALUES ($1, $2, $3, $3, $4, NULL, $5, $6)`,
    [hashSessionId(sid), user.email, now, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null],
  );
  // Opportunistic housekeeping (about 1 in 20 sign-ins), so the table can't grow without bound.
  if (Math.random() < 0.05) await pruneSessions();
  return { token: createToken({ ...user, sid }, expiresAt), sid, expiresAt };
}

/** Deletes sessions that ended (expired or revoked) more than a day ago. */
export async function pruneSessions() {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  await query("DELETE FROM auth_sessions WHERE expires_at < $1 OR (revoked_at IS NOT NULL AND revoked_at < $1)", [dayAgo]);
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
  const now = Date.now();
  const row = (
    await query<{
      last_seen_at: string;
      expires_at: string;
      revoked_at: string | null;
      email: string;
      name: string | null;
      role: string;
    }>(
      `SELECT s.last_seen_at, s.expires_at, s.revoked_at, u.email, u.name, u.role
       FROM auth_sessions s JOIN users u ON u.email = s.email WHERE s.id_hash = $1`,
      [hashSessionId(t.sid)],
    )
  )[0];
  if (!row || row.revoked_at != null) return null;
  const lastSeen = Number(row.last_seen_at);
  if (Number(row.expires_at) <= now || now - lastSeen > IDLE_TTL_MS) return null;
  if (!isRole(row.role)) return null;
  if (now - lastSeen > TOUCH_EVERY_MS) {
    await query("UPDATE auth_sessions SET last_seen_at = $1 WHERE id_hash = $2", [now, hashSessionId(t.sid)]);
  }
  return { sid: t.sid, email: row.email, name: row.name ?? "", role: row.role };
}

/** Revokes one session by its raw id. */
export async function revokeSession(sid: string) {
  await query("UPDATE auth_sessions SET revoked_at = $1 WHERE id_hash = $2 AND revoked_at IS NULL", [Date.now(), hashSessionId(sid)]);
}

/** Revokes every live session of a user, optionally keeping one (the caller's). Returns how many. */
export async function revokeUserSessions(email: string, exceptSid?: string): Promise<number> {
  const rows = await query(
    `UPDATE auth_sessions SET revoked_at = $1 WHERE email = $2 AND revoked_at IS NULL AND id_hash != $3 RETURNING id_hash`,
    [Date.now(), email, exceptSid ? hashSessionId(exceptSid) : ""],
  );
  return rows.length;
}

/** Live (unrevoked, unexpired) session count for a user. */
export async function activeSessionCount(email: string): Promise<number> {
  const now = Date.now();
  const rows = await query<{ c: string }>(
    "SELECT COUNT(*) c FROM auth_sessions WHERE email = $1 AND revoked_at IS NULL AND expires_at > $2 AND last_seen_at > $3",
    [email, now, now - IDLE_TTL_MS],
  );
  return Number(rows[0].c);
}
