import { rawDbClient } from "@/lib/db/client";
import { ensureAuthSchema } from "./db";

export { clientIp } from "./net";

/** At most 5 attempts inside 15 minutes per key; going over locks that key for 15 minutes. */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

/** Throttle keys for an attempt: one per email (normalized) and, when the IP is trusted, one per IP. */
export function throttleKeys(scope: string, email: string | null, ip: string | null): string[] {
  const keys: string[] = [];
  if (email) keys.push(`${scope}:email:${email.trim().toLowerCase()}`);
  if (ip) keys.push(`${scope}:ip:${ip}`);
  return keys;
}

export type Reservation =
  | { ok: true; keys: string[]; counts: number[] }
  | { ok: false; retryAfterSeconds: number };

/**
 * Count first, verify second. Atomically counts one attempt against every key (one UPSERT ...
 * RETURNING per key, so concurrent requests each see a distinct count) and refuses when a key is
 * locked or the count went past MAX_FAILURES. Going past the limit also starts the lock. Callers
 * must then call attemptFailed() or attemptSucceeded() with the reservation.
 *
 * A burst of N parallel guesses therefore gets at most MAX_FAILURES verifications per key.
 */
export async function reserveAttempt(keys: string[]): Promise<Reservation> {
  if (!keys.length) return { ok: true, keys, counts: [] };
  await ensureAuthSchema();
  const db = rawDbClient();
  const now = Date.now();
  const counts: number[] = [];
  let lockedMs = 0;
  for (const key of keys) {
    // In DO UPDATE every column reference is the OLD row value. "fresh" = the previous lock has
    // ended or the window has passed, so counting restarts at 1.
    const fresh = `((auth_throttle.locked_until IS NOT NULL AND auth_throttle.locked_until <= :now)
                    OR (auth_throttle.locked_until IS NULL AND :now - auth_throttle.first_at > :win))`;
    const r = (
      await db.execute({
        sql: `INSERT INTO auth_throttle (key, failures, first_at, locked_until) VALUES (:key, 1, :now, NULL)
              ON CONFLICT(key) DO UPDATE SET
                failures = CASE WHEN auth_throttle.locked_until > :now THEN auth_throttle.failures
                                WHEN ${fresh} THEN 1
                                ELSE auth_throttle.failures + 1 END,
                first_at = CASE WHEN auth_throttle.locked_until > :now THEN auth_throttle.first_at
                                WHEN ${fresh} THEN :now
                                ELSE auth_throttle.first_at END,
                locked_until = CASE WHEN auth_throttle.locked_until > :now THEN auth_throttle.locked_until
                                    WHEN ${fresh} THEN NULL
                                    WHEN auth_throttle.failures + 1 > :max THEN :now + :lock
                                    ELSE auth_throttle.locked_until END
              RETURNING failures, locked_until`,
        args: { key, now, win: WINDOW_MS, max: MAX_FAILURES, lock: LOCK_MS },
      })
    ).rows[0];
    const lockedUntil = Number(r?.locked_until ?? 0);
    if (lockedUntil > now) lockedMs = Math.max(lockedMs, lockedUntil - now);
    counts.push(Number(r?.failures ?? 0));
  }
  if (Math.random() < 0.05) await pruneThrottle();
  if (lockedMs) return { ok: false, retryAfterSeconds: Math.ceil(lockedMs / 1000) };
  return { ok: true, keys, counts };
}

/**
 * The reserved attempt failed. Locks every key whose count reached MAX_FAILURES (the 5th failure
 * locks). Returns the lockout in seconds, or 0.
 */
export async function attemptFailed(res: Reservation): Promise<number> {
  if (!res.ok) return res.retryAfterSeconds;
  const now = Date.now();
  let locked = 0;
  for (let i = 0; i < res.keys.length; i++) {
    if (res.counts[i] < MAX_FAILURES) continue;
    await rawDbClient().execute({
      sql: "UPDATE auth_throttle SET locked_until = ? WHERE key = ? AND (locked_until IS NULL OR locked_until <= ?)",
      args: [now + LOCK_MS, res.keys[i], now],
    });
    locked = LOCK_MS;
  }
  return locked ? Math.ceil(locked / 1000) : 0;
}

/**
 * The reserved attempt succeeded: forget the keys in `clear` (e.g. the email key after a correct
 * password) and give the attempt back to every other key (e.g. the shared IP key), unless locked.
 */
export async function attemptSucceeded(res: Reservation, clear: string[] = []) {
  if (!res.ok) return;
  const db = rawDbClient();
  const now = Date.now();
  for (const key of res.keys) {
    if (clear.includes(key)) {
      await db.execute({
        sql: "DELETE FROM auth_throttle WHERE key = ? AND (locked_until IS NULL OR locked_until <= ?)",
        args: [key, now],
      });
    } else {
      await db.execute({
        sql: "UPDATE auth_throttle SET failures = MAX(failures - 1, 0) WHERE key = ? AND (locked_until IS NULL OR locked_until <= ?)",
        args: [key, now],
      });
    }
  }
}

/** Convenience for tests and one-shot callers: count an attempt and mark it failed. */
export async function recordFailure(keys: string[]): Promise<number> {
  return attemptFailed(await reserveAttempt(keys));
}

/** Seconds until every key is unlocked; 0 when none is locked. Read-only. */
export async function lockedFor(keys: string[]): Promise<number> {
  if (!keys.length) return 0;
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

/** Drops rows whose window and lock both ended more than a window ago. */
export async function pruneThrottle() {
  const now = Date.now();
  await rawDbClient().execute({
    sql: "DELETE FROM auth_throttle WHERE first_at < ? AND (locked_until IS NULL OR locked_until < ?)",
    args: [now - 2 * WINDOW_MS, now],
  });
}

export function lockoutMessage(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** The standard 429 body + Retry-After header. */
export function lockoutResponse(seconds: number) {
  return Response.json(
    { error: lockoutMessage(seconds), retryAfterSeconds: seconds },
    { status: 429, headers: { "retry-after": String(seconds) } },
  );
}
