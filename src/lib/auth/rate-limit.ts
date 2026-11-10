import { rawDbClient } from "@/lib/db/client";
import { ensureAuthSchema } from "./db";

/** 5 failures inside 15 minutes locks that key for 15 minutes. */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

/** Throttle keys for a sign-in attempt: one per email (normalized), one per client IP. */
export function throttleKeys(scope: string, email: string | null, ip: string): string[] {
  const keys = [`${scope}:ip:${ip}`];
  if (email) keys.unshift(`${scope}:email:${email.trim().toLowerCase()}`);
  return keys;
}

/** Seconds until every key is unlocked; 0 when none is locked. */
export async function lockedFor(keys: string[]): Promise<number> {
  await ensureAuthSchema();
  const now = Date.now();
  const rows = (
    await rawDbClient().execute({
      sql: `SELECT MAX(locked_until) l FROM auth_throttle WHERE key IN (${keys.map(() => "?").join(",")}) AND locked_until > ?`,
      args: [...keys, now],
    })
  ).rows;
  const until = Number(rows[0]?.l ?? 0);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/**
 * Counts one failure against every key. Returns seconds of lockout when this failure locked
 * (or a key already was locked), else 0.
 */
export async function recordFailure(keys: string[]): Promise<number> {
  await ensureAuthSchema();
  const db = rawDbClient();
  const now = Date.now();
  let locked = 0;
  for (const key of keys) {
    const r = (
      await db.execute({
        sql: `INSERT INTO auth_throttle (key, failures, first_at, locked_until) VALUES (?, 1, ?, NULL)
              ON CONFLICT(key) DO UPDATE SET
                failures   = CASE WHEN excluded.first_at - auth_throttle.first_at > ? THEN 1 ELSE auth_throttle.failures + 1 END,
                first_at   = CASE WHEN excluded.first_at - auth_throttle.first_at > ? THEN excluded.first_at ELSE auth_throttle.first_at END
              RETURNING failures, locked_until`,
        args: [key, now, WINDOW_MS, WINDOW_MS],
      })
    ).rows[0];
    const lockedUntil = Number(r?.locked_until ?? 0);
    if (lockedUntil > now) {
      locked = Math.max(locked, lockedUntil - now);
    } else if (Number(r?.failures ?? 0) >= MAX_FAILURES) {
      // Lock, and start a fresh count for when the lock ends.
      await db.execute({
        sql: "UPDATE auth_throttle SET locked_until = ?, failures = 0, first_at = ? WHERE key = ?",
        args: [now + LOCK_MS, now, key],
      });
      locked = Math.max(locked, LOCK_MS);
    }
  }
  // Housekeeping: drop stale rows so the table stays small.
  await db.execute({
    sql: "DELETE FROM auth_throttle WHERE first_at < ? AND (locked_until IS NULL OR locked_until < ?)",
    args: [now - 24 * 60 * 60 * 1000, now],
  });
  return locked ? Math.ceil(locked / 1000) : 0;
}

/** Forgets failures for these keys (call with the email key after a successful sign-in). */
export async function clearFailures(keys: string[]) {
  await ensureAuthSchema();
  await rawDbClient().execute({
    sql: `DELETE FROM auth_throttle WHERE key IN (${keys.map(() => "?").join(",")}) AND (locked_until IS NULL OR locked_until <= ?)`,
    args: [...keys, Date.now()],
  });
}

/** Best-effort client IP. Behind a proxy/CDN this is the left-most X-Forwarded-For entry. */
export function clientIp(h: Headers): string {
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("x-real-ip")?.trim() || "unknown";
}

export function lockoutMessage(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
